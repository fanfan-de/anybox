import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type { CSSProperties, WheelEvent as ReactWheelEvent } from "react"
import { ExpandIcon, ForkIcon, MinimizeIcon } from "../icons"
import { useI18n } from "../i18n/I18nProvider"
import type { SessionMessageTree } from "../session-message-tree"
import { joinClassNames } from "../shared-ui"
import { ThreadMarkdown, type MarkdownArtifactLinkTarget, type MarkdownLocalFileLinkTarget } from "../thread-markdown"
import type { SessionSummary } from "../types"

interface SessionMessageTreePanelProps {
  messageTree: SessionMessageTree | null
  onArtifactLinkOpen?: (target: MarkdownArtifactLinkTarget) => void
  onLocalFileLinkOpen?: (target: MarkdownLocalFileLinkTarget) => void
  session: SessionSummary | null
  onSelectMessage: (sessionID: string, messageID: string) => void | Promise<void>
  onOpenBranchChat?: (messageID: string) => void
}

function countBranchPoints(messageTree: SessionMessageTree) {
  return Object.entries(messageTree.childIDsByParentID).filter(([parentID, childIDs]) => (
    Boolean(messageTree.nodesByID[parentID]) && childIDs.length > 1
  )).length
}

interface MessageTreeGraphNode {
  cardHeight?: number
  cardWidth?: number
  column: number
  depth: number
  height: number
  id: string
  width: number
  x: number
  y: number
}

interface MessageTreeGraphEdge {
  fromID: string
  fromSourceY: number
  fromX: number
  fromY: number
  isActivePath: boolean
  toID: string
  toX: number
  toY: number
}

interface MessageTreeCanvasPanState {
  pointerID: number
  startClientX: number
  startClientY: number
  startPanX: number
  startPanY: number
}

interface MessageTreeGraphPan {
  x: number
  y: number
}

interface MessageTreeGraphNodeDimensions {
  cardHeight?: number
  cardWidth?: number
  height: number
  width: number
}

interface MessageTreeGraphAnchor {
  messageID: string
  screenX: number
  screenY: number
}

const COLLAPSED_NODE_HEIGHT = 56
const COLLAPSED_NODE_WIDTH = 136
const EXPANDED_RESPONSE_NODE_MIN_HEIGHT = 270
const EXPANDED_RESPONSE_CARD_MIN_WIDTH = 360
const EXPANDED_RESPONSE_CARD_MAX_WIDTH = 560
const EXPANDED_RESPONSE_CARD_MIN_HEIGHT = 232
const EXPANDED_RESPONSE_CARD_MAX_HEIGHT = 420
const EXPANDED_RESPONSE_NODE_HORIZONTAL_CHROME = 16
const EXPANDED_RESPONSE_NODE_CHROME_HEIGHT = EXPANDED_RESPONSE_NODE_MIN_HEIGHT - EXPANDED_RESPONSE_CARD_MIN_HEIGHT
const RESPONSE_CARD_HEADER_MIN_HEIGHT = 32
const RESPONSE_CARD_BODY_VERTICAL_PADDING = 18
const RESPONSE_CARD_BODY_HORIZONTAL_COMFORT = 48
const RESPONSE_CARD_BODY_FONT_SIZE = 12
const RESPONSE_CARD_BODY_LINE_HEIGHT = RESPONSE_CARD_BODY_FONT_SIZE * 1.42
const RESPONSE_CARD_ESTIMATED_LATIN_CHARACTER_WIDTH = 7.2
const RESPONSE_CARD_ESTIMATED_CJK_CHARACTER_WIDTH = RESPONSE_CARD_BODY_FONT_SIZE
const EXPANDED_RESPONSE_COLUMN_GAP = 44
const GRAPH_LAYOUT_PADDING = 40
const NODE_VERTICAL_GAP = 36
const MIN_GRAPH_ZOOM = 0.5
const MAX_GRAPH_ZOOM = 1.8
const GRAPH_ZOOM_DELTA_FACTOR = 0.0014
const SIBLING_WHEEL_SWITCH_DELTA = 90
const SIBLING_WHEEL_GESTURE_RESET_MS = 140
const SIBLING_WHEEL_LINE_DELTA_PX = 40
const SIBLING_WHEEL_PAGE_DELTA_PX = 480
const SIBLING_WHEEL_MAX_EVENT_DELTA_PX = 120
const MESSAGE_TREE_LAYOUT_ANIMATION_DURATION_MS = 260
const WHEEL_DELTA_LINE_MODE = 1
const WHEEL_DELTA_PAGE_MODE = 2

interface MessageTreeLayoutAnimationPosition {
  x: number
  y: number
}

interface MessageTreeLayoutAnimationSnapshot {
  pan: MessageTreeGraphPan
  positions: Map<string, MessageTreeLayoutAnimationPosition>
  zoom: number
}

interface SiblingWheelSwitchState {
  accumulatedDeltaY: number
  direction: -1 | 1
  hasSwitchedInGesture: boolean
  lastWheelAt: number
  messageID: string
}

type MessageTreeGraphNodeStyle = CSSProperties & {
  "--session-message-tree-expanded-node-width"?: string
  "--session-message-tree-expanded-node-height"?: string
  "--session-message-tree-response-card-height"?: string
  "--session-message-tree-response-card-width"?: string
  "--session-message-tree-response-card-min-height"?: string
}

function canExpandMessageTreeNode(node: SessionMessageTree["nodesByID"][string] | undefined) {
  return Boolean(node && node.role === "assistant" && node.content.trim())
}

function getExpandableMessageTreeNodeIDs(messageTree: SessionMessageTree) {
  return Object.values(messageTree.nodesByID)
    .filter(canExpandMessageTreeNode)
    .map((node) => node.id)
}

function isWideResponseTextCharacter(character: string) {
  const codePoint = character.codePointAt(0) ?? 0

  return (
    (codePoint >= 0x1100 && codePoint <= 0x11ff) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7af) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xffef) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff)
  )
}

function estimateResponseTextCharacterWidth(character: string) {
  if (character === "\t") return RESPONSE_CARD_ESTIMATED_LATIN_CHARACTER_WIDTH * 2
  if (character === " ") return RESPONSE_CARD_ESTIMATED_LATIN_CHARACTER_WIDTH * 0.55
  if (isWideResponseTextCharacter(character)) return RESPONSE_CARD_ESTIMATED_CJK_CHARACTER_WIDTH
  return RESPONSE_CARD_ESTIMATED_LATIN_CHARACTER_WIDTH
}

function estimateResponseTextLineWidth(line: string) {
  let lineWidth = 0
  for (const character of line) {
    lineWidth += estimateResponseTextCharacterWidth(character)
  }
  return lineWidth
}

function estimateWrappedResponseTextLineCount(line: string, wrapWidth: number) {
  if (!line) return 1

  let lineCount = 1
  let lineWidth = 0

  for (const character of line) {
    const characterWidth = estimateResponseTextCharacterWidth(character)
    if (lineWidth > 0 && lineWidth + characterWidth > wrapWidth) {
      lineCount += 1
      lineWidth = characterWidth
    } else {
      lineWidth += characterWidth
    }
  }

  return lineCount
}

function clampExpandedResponseCardWidth(value: number) {
  if (!Number.isFinite(value)) return EXPANDED_RESPONSE_CARD_MIN_WIDTH
  return Math.min(EXPANDED_RESPONSE_CARD_MAX_WIDTH, Math.max(EXPANDED_RESPONSE_CARD_MIN_WIDTH, value))
}

function estimateExpandedResponseCardWidth(content: string) {
  const maxLineWidth = content
    .split(/\r\n|\r|\n/)
    .reduce((maxWidth, line) => Math.max(maxWidth, estimateResponseTextLineWidth(line)), 0)

  return Math.ceil(clampExpandedResponseCardWidth(maxLineWidth + RESPONSE_CARD_BODY_HORIZONTAL_COMFORT))
}

function estimateExpandedResponseNodeDimensions(content: string) {
  const cardWidth = estimateExpandedResponseCardWidth(content)
  const wrapWidth = Math.max(1, cardWidth - RESPONSE_CARD_BODY_HORIZONTAL_COMFORT)
  const lineCount = Math.max(
    1,
    content.split(/\r\n|\r|\n/).reduce((total, line) => total + estimateWrappedResponseTextLineCount(line, wrapWidth), 0),
  )
  const responseCardHeight = Math.ceil(
    RESPONSE_CARD_HEADER_MIN_HEIGHT +
      RESPONSE_CARD_BODY_VERTICAL_PADDING +
      lineCount * RESPONSE_CARD_BODY_LINE_HEIGHT,
  )
  const cardHeight = Math.min(
    EXPANDED_RESPONSE_CARD_MAX_HEIGHT,
    Math.max(EXPANDED_RESPONSE_CARD_MIN_HEIGHT, responseCardHeight),
  )

  return {
    cardHeight,
    cardWidth,
    height: Math.max(EXPANDED_RESPONSE_NODE_MIN_HEIGHT, cardHeight + EXPANDED_RESPONSE_NODE_CHROME_HEIGHT),
    width: cardWidth + EXPANDED_RESPONSE_NODE_HORIZONTAL_CHROME,
  }
}

function getGraphNodeDimensions(
  messageTree: SessionMessageTree,
  messageID: string,
  expandedResponseMessageIDs: Set<string>,
): MessageTreeGraphNodeDimensions {
  const node = messageTree.nodesByID[messageID]
  if (expandedResponseMessageIDs.has(messageID) && canExpandMessageTreeNode(node)) {
    return estimateExpandedResponseNodeDimensions(node.content)
  }

  return {
    height: COLLAPSED_NODE_HEIGHT,
    width: COLLAPSED_NODE_WIDTH,
  }
}

function getExpandedResponseLayoutWidth(
  messageTree: SessionMessageTree,
  expandedResponseMessageIDs: Set<string>,
) {
  let maxWidth = EXPANDED_RESPONSE_CARD_MIN_WIDTH + EXPANDED_RESPONSE_NODE_HORIZONTAL_CHROME

  for (const messageID of expandedResponseMessageIDs) {
    const node = messageTree.nodesByID[messageID]
    if (!canExpandMessageTreeNode(node)) continue
    maxWidth = Math.max(maxWidth, estimateExpandedResponseNodeDimensions(node.content).width)
  }

  return maxWidth
}

function getBranchRootIDForChildResponse(
  messageTree: SessionMessageTree,
  focusedExpandedResponseMessageID: string,
  childResponseMessageID: string,
) {
  let branchRootID = childResponseMessageID
  let parentMessageID = messageTree.nodesByID[branchRootID]?.parentMessageID ?? null
  const seen = new Set<string>()

  while (parentMessageID && parentMessageID !== focusedExpandedResponseMessageID) {
    if (seen.has(parentMessageID)) return childResponseMessageID
    seen.add(parentMessageID)
    branchRootID = parentMessageID
    parentMessageID = messageTree.nodesByID[branchRootID]?.parentMessageID ?? null
  }

  return parentMessageID === focusedExpandedResponseMessageID ? branchRootID : childResponseMessageID
}

function moveMessageTreeSubtreeColumns(input: {
  columnDelta: number
  columnGap: number
  messageID: string
  messageTree: SessionMessageTree
  nodesByID: Map<string, MessageTreeGraphNode>
  visited: Set<string>
}) {
  if (input.visited.has(input.messageID)) return
  input.visited.add(input.messageID)

  const layoutNode = input.nodesByID.get(input.messageID)
  if (layoutNode) {
    layoutNode.column += input.columnDelta
    layoutNode.x += input.columnDelta * input.columnGap
  }

  for (const childID of input.messageTree.childIDsByParentID[input.messageID] ?? []) {
    moveMessageTreeSubtreeColumns({
      ...input,
      messageID: childID,
    })
  }
}

function centerChildResponseBranchesAroundFocusedResponse(input: {
  centeredChildResponseMessageID: string | null
  childResponseMessageIDs: string[]
  columnGap: number
  focusedExpandedResponseMessageID: string | null
  messageTree: SessionMessageTree
  nodesByID: Map<string, MessageTreeGraphNode>
}) {
  if (
    !input.focusedExpandedResponseMessageID ||
    !input.centeredChildResponseMessageID ||
    input.childResponseMessageIDs.length <= 1
  ) {
    return
  }

  const focusedNode = input.nodesByID.get(input.focusedExpandedResponseMessageID)
  const selectedIndex = input.childResponseMessageIDs.indexOf(input.centeredChildResponseMessageID)
  if (!focusedNode || selectedIndex < 0) return

  const movedMessageIDs = new Set<string>()
  for (const [index, childResponseMessageID] of input.childResponseMessageIDs.entries()) {
    const branchRootID = getBranchRootIDForChildResponse(
      input.messageTree,
      input.focusedExpandedResponseMessageID,
      childResponseMessageID,
    )
    const branchRoot = input.nodesByID.get(branchRootID)
    if (!branchRoot) continue

    const targetColumn = focusedNode.column + index - selectedIndex
    const columnDelta = targetColumn - branchRoot.column
    if (Math.abs(columnDelta) < 0.001) continue

    moveMessageTreeSubtreeColumns({
      columnDelta,
      columnGap: input.columnGap,
      messageID: branchRootID,
      messageTree: input.messageTree,
      nodesByID: input.nodesByID,
      visited: movedMessageIDs,
    })
  }
}

function normalizeGraphLayoutBounds(nodesByID: Map<string, MessageTreeGraphNode>) {
  let minLeft = Number.POSITIVE_INFINITY
  let maxRight = Number.NEGATIVE_INFINITY
  let maxBottom = Number.NEGATIVE_INFINITY

  for (const node of nodesByID.values()) {
    minLeft = Math.min(minLeft, node.x - node.width / 2)
    maxRight = Math.max(maxRight, node.x + node.width / 2)
    maxBottom = Math.max(maxBottom, node.y + node.height)
  }

  if (!Number.isFinite(minLeft) || !Number.isFinite(maxRight) || !Number.isFinite(maxBottom)) {
    return {
      height: 160,
      width: 260,
    }
  }

  const shiftX = Math.max(0, GRAPH_LAYOUT_PADDING - minLeft)
  if (shiftX > 0) {
    for (const node of nodesByID.values()) {
      node.x += shiftX
    }
    maxRight += shiftX
  }

  return {
    height: Math.max(160, maxBottom + GRAPH_LAYOUT_PADDING),
    width: Math.max(260, maxRight + GRAPH_LAYOUT_PADDING),
  }
}

function getChildResponseMessageIDs(messageTree: SessionMessageTree, messageID: string | null) {
  if (!messageID) return []

  const childResponseMessageIDs: string[] = []

  for (const childID of messageTree.childIDsByParentID[messageID] ?? []) {
    const child = messageTree.nodesByID[childID]
    if (canExpandMessageTreeNode(child)) {
      childResponseMessageIDs.push(childID)
      continue
    }

    for (const grandchildID of messageTree.childIDsByParentID[childID] ?? []) {
      if (canExpandMessageTreeNode(messageTree.nodesByID[grandchildID])) {
        childResponseMessageIDs.push(grandchildID)
      }
    }
  }

  return childResponseMessageIDs
}

function getDefaultCenteredChildResponseID(
  childResponseMessageIDs: string[],
  activePathSet: Set<string>,
) {
  return childResponseMessageIDs.find((messageID) => activePathSet.has(messageID)) ?? childResponseMessageIDs[0] ?? null
}

function getMessageIDForChildResponseSelection(
  messageTree: SessionMessageTree,
  expandedResponseMessageID: string,
  childResponseMessageID: string,
) {
  const childResponse = messageTree.nodesByID[childResponseMessageID]
  const childResponseParentID = childResponse?.parentMessageID ?? null
  const directBranchOption = childResponseParentID
    ? messageTree.branchOptionsByParentID[childResponseParentID]?.find((option) => (
      option.childMessageID === childResponseMessageID
    ))
    : undefined
  const expandedBranchOption = messageTree.branchOptionsByParentID[expandedResponseMessageID]?.find((option) => (
    option.childMessageID === childResponseMessageID ||
      (childResponseParentID !== null && option.childMessageID === childResponseParentID)
  ))

  return directBranchOption?.leafMessageID ?? expandedBranchOption?.leafMessageID ?? childResponseMessageID
}

function buildGraphLayout(
  messageTree: SessionMessageTree,
  activePathSet: Set<string>,
  expandedResponseMessageIDs: Set<string>,
  focusedExpandedResponseMessageID: string | null,
  centeredChildResponseMessageID: string | null,
) {
  const nodesByID = new Map<string, MessageTreeGraphNode>()
  const rawEdges: Array<{ fromID: string; toID: string }> = []
  const hasExpandedResponse = expandedResponseMessageIDs.size > 0
  const focusedChildResponseMessageIDs = getChildResponseMessageIDs(messageTree, focusedExpandedResponseMessageID)
  const expandedResponseLayoutWidth = getExpandedResponseLayoutWidth(messageTree, expandedResponseMessageIDs)
  const columnGap = hasExpandedResponse
    ? expandedResponseLayoutWidth + EXPANDED_RESPONSE_COLUMN_GAP
    : 156
  const originX = hasExpandedResponse
    ? Math.round(expandedResponseLayoutWidth / 2) + 4 + Math.max(0, focusedChildResponseMessageIDs.length - 1) * columnGap
    : 92
  const originY = 28
  let nextColumn = 0
  let maxDepth = 0

  function visit(messageID: string, depth: number, y: number, parentID: string | null, visited: Set<string>): number | null {
    if (visited.has(messageID)) return null
    if (!messageTree.nodesByID[messageID]) return null

    maxDepth = Math.max(maxDepth, depth)

    if (parentID) {
      rawEdges.push({ fromID: parentID, toID: messageID })
    }

    const nextVisited = new Set(visited)
    nextVisited.add(messageID)
    const childColumns: number[] = []
    const nodeDimensions = getGraphNodeDimensions(messageTree, messageID, expandedResponseMessageIDs)

    for (const childID of messageTree.childIDsByParentID[messageID] ?? []) {
      const childColumn = visit(childID, depth + 1, y + nodeDimensions.height + NODE_VERTICAL_GAP, messageID, nextVisited)
      if (childColumn !== null) {
        childColumns.push(childColumn)
      }
    }

    let column = childColumns.length > 0
      ? childColumns.reduce((total, value) => total + value, 0) / childColumns.length
      : nextColumn++

    nodesByID.set(messageID, {
      cardHeight: nodeDimensions.cardHeight,
      cardWidth: nodeDimensions.cardWidth,
      column,
      depth,
      height: nodeDimensions.height,
      id: messageID,
      width: nodeDimensions.width,
      x: originX + column * columnGap,
      y,
    })

    return column
  }

  for (const rootMessageID of messageTree.rootMessageIDs) {
    visit(rootMessageID, 0, originY, null, new Set())
  }

  centerChildResponseBranchesAroundFocusedResponse({
    centeredChildResponseMessageID,
    childResponseMessageIDs: focusedChildResponseMessageIDs,
    columnGap,
    focusedExpandedResponseMessageID,
    messageTree,
    nodesByID,
  })

  const graphBounds = normalizeGraphLayoutBounds(nodesByID)

  const edges: MessageTreeGraphEdge[] = rawEdges.flatMap((edge) => {
    const from = nodesByID.get(edge.fromID)
    const to = nodesByID.get(edge.toID)
    if (!from || !to) return []

    return [{
      fromID: edge.fromID,
      fromSourceY: from.y + (from.height > COLLAPSED_NODE_HEIGHT ? from.height - 18 : 20),
      fromX: from.x,
      fromY: from.y,
      isActivePath: activePathSet.has(edge.fromID) && activePathSet.has(edge.toID),
      toID: edge.toID,
      toX: to.x,
      toY: to.y,
    }]
  })

  const nodes = [...nodesByID.values()].sort((left, right) => (
    left.depth === right.depth
      ? left.column - right.column
      : left.depth - right.depth
  ))

  return {
    edges,
    height: hasExpandedResponse
      ? graphBounds.height
      : Math.max(graphBounds.height, originY + (maxDepth + 1) * (COLLAPSED_NODE_HEIGHT + NODE_VERTICAL_GAP) + 34),
    nodes,
    width: graphBounds.width,
  }
}

function buildEdgePath(edge: MessageTreeGraphEdge) {
  const startX = edge.fromX
  const startY = edge.fromSourceY
  const endX = edge.toX
  const endY = edge.toY - 10
  const middleY = startY + Math.max(18, (endY - startY) * 0.5)

  return `M ${startX} ${startY} L ${startX} ${middleY} L ${endX} ${middleY} L ${endX} ${endY}`
}

function clampGraphZoom(value: number) {
  if (!Number.isFinite(value)) return 1
  return Math.min(MAX_GRAPH_ZOOM, Math.max(MIN_GRAPH_ZOOM, value))
}

function shouldAllowResponseTextContextMenu(event: MouseEvent) {
  const target = event.target
  const targetElement = target instanceof Element ? target : null
  if (!targetElement?.closest(".session-message-tree-response-card-body")) return false
  return Boolean(window.getSelection?.()?.toString().trim())
}

function normalizeSiblingWheelDeltaY(event: Pick<WheelEvent, "deltaMode" | "deltaY">) {
  if (!Number.isFinite(event.deltaY)) return 0

  const modeMultiplier = event.deltaMode === WHEEL_DELTA_LINE_MODE
    ? SIBLING_WHEEL_LINE_DELTA_PX
    : event.deltaMode === WHEEL_DELTA_PAGE_MODE
      ? SIBLING_WHEEL_PAGE_DELTA_PX
      : 1
  const normalizedDeltaY = event.deltaY * modeMultiplier

  return Math.min(
    SIBLING_WHEEL_MAX_EVENT_DELTA_PX,
    Math.max(-SIBLING_WHEEL_MAX_EVENT_DELTA_PX, normalizedDeltaY),
  )
}

export function SessionMessageTreePanel({
  messageTree,
  onArtifactLinkOpen,
  onLocalFileLinkOpen,
  session,
  onSelectMessage,
  onOpenBranchChat,
}: SessionMessageTreePanelProps) {
  const { t } = useI18n()
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const canvasPanCleanupRef = useRef<(() => void) | null>(null)
  const canvasPanStateRef = useRef<MessageTreeCanvasPanState | null>(null)
  const graphPanLayoutKeyRef = useRef<string | null>(null)
  const graphPanWasUserControlledRef = useRef(false)
  const pendingGraphAnchorRef = useRef<MessageTreeGraphAnchor | null>(null)
  const [graphPan, setGraphPan] = useState<MessageTreeGraphPan>({ x: 0, y: 0 })
  const graphPanRef = useRef<MessageTreeGraphPan>(graphPan)
  const [graphZoom, setGraphZoom] = useState(1)
  const graphZoomRef = useRef(graphZoom)
  const [isCanvasPanning, setIsCanvasPanning] = useState(false)
  const [isFullyExpanded, setIsFullyExpanded] = useState(false)
  const [expandedResponseMessageID, setExpandedResponseMessageID] = useState<string | null>(null)
  const [centeredChildResponseMessageID, setCenteredChildResponseMessageID] = useState<string | null>(null)
  const pendingLayoutAnimationSnapshotRef = useRef<MessageTreeLayoutAnimationSnapshot | null>(null)
  const layoutAnimationFrameRef = useRef<number | null>(null)
  const siblingWheelSwitchRef = useRef<SiblingWheelSwitchState | null>(null)
  const markerBaseID = useId().replace(/[^a-zA-Z0-9_-]/g, "")
  const markerID = `${markerBaseID}-tree-arrow`
  const activeMarkerID = `${markerBaseID}-tree-arrow-active`
  const activePathKey = messageTree?.activePathMessageIDs.join("\u0000") ?? ""
  const activePathSet = useMemo(() => new Set(messageTree?.activePathMessageIDs ?? []), [activePathKey, messageTree])
  const focusedExpandedResponseMessageID = isFullyExpanded ? null : expandedResponseMessageID
  const childResponseMessageIDs = useMemo(
    () => (messageTree ? getChildResponseMessageIDs(messageTree, focusedExpandedResponseMessageID) : []),
    [focusedExpandedResponseMessageID, messageTree],
  )
  const effectiveCenteredChildResponseMessageID = useMemo(() => {
    if (
      centeredChildResponseMessageID &&
      childResponseMessageIDs.includes(centeredChildResponseMessageID)
    ) {
      return centeredChildResponseMessageID
    }

    return getDefaultCenteredChildResponseID(childResponseMessageIDs, activePathSet)
  }, [activePathSet, centeredChildResponseMessageID, childResponseMessageIDs])
  const expandedResponseMessageIDs = useMemo(() => {
    const nextMessageIDs = new Set<string>()
    if (!messageTree) return nextMessageIDs
    if (isFullyExpanded) {
      for (const messageID of getExpandableMessageTreeNodeIDs(messageTree)) {
        nextMessageIDs.add(messageID)
      }
      return nextMessageIDs
    }

    if (
      focusedExpandedResponseMessageID &&
      canExpandMessageTreeNode(messageTree.nodesByID[focusedExpandedResponseMessageID])
    ) {
      nextMessageIDs.add(focusedExpandedResponseMessageID)
    }

    for (const childResponseMessageID of childResponseMessageIDs) {
      if (canExpandMessageTreeNode(messageTree.nodesByID[childResponseMessageID])) {
        nextMessageIDs.add(childResponseMessageID)
      }
    }

    return nextMessageIDs
  }, [childResponseMessageIDs, focusedExpandedResponseMessageID, isFullyExpanded, messageTree])
  const expandedResponseMessageIDsKey = [...expandedResponseMessageIDs].join("\u0000")
  const graphLayout = useMemo(
    () => (messageTree
      ? buildGraphLayout(
        messageTree,
        activePathSet,
        expandedResponseMessageIDs,
        focusedExpandedResponseMessageID,
        isFullyExpanded ? null : effectiveCenteredChildResponseMessageID,
      )
      : null),
    [
      activePathSet,
      effectiveCenteredChildResponseMessageID,
      expandedResponseMessageIDs,
      focusedExpandedResponseMessageID,
      isFullyExpanded,
      messageTree,
    ],
  )
  const nodeCount = messageTree ? Object.keys(messageTree.nodesByID).length : 0
  const branchPointCount = messageTree ? countBranchPoints(messageTree) : 0
  const hasRootNodes = Boolean(messageTree?.rootMessageIDs.some((messageID) => messageTree.nodesByID[messageID]))
  const graphLayoutKey = graphLayout
    ? [
      messageTree?.sessionID ?? "",
      graphLayout.width,
      graphLayout.height,
      nodeCount,
      expandedResponseMessageIDsKey,
      effectiveCenteredChildResponseMessageID ?? "",
    ].join(":")
    : ""

  useEffect(() => () => {
    stopCanvasPan()
    if (layoutAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(layoutAnimationFrameRef.current)
      layoutAnimationFrameRef.current = null
    }
  }, [])

  useEffect(() => {
    graphPanRef.current = graphPan
  }, [graphPan])

  useEffect(() => {
    graphZoomRef.current = graphZoom
  }, [graphZoom])

  useEffect(() => {
    if (!expandedResponseMessageID) return
    if (canExpandMessageTreeNode(messageTree?.nodesByID[expandedResponseMessageID])) return
    setExpandedResponseMessageID(null)
    setCenteredChildResponseMessageID(null)
  }, [expandedResponseMessageID, messageTree])

  useLayoutEffect(() => {
    if (!graphLayout) return

    const canvas = canvasRef.current
    if (!canvas) return
    const canvasElement = canvas
    const layout = graphLayout
    let frameID: number | null = null
    let attempts = 0

    function readCanvasSize() {
      const canvasWidth = canvasElement.clientWidth
      const canvasHeight = canvasElement.clientHeight

      if (canvasWidth <= 0 || canvasHeight <= 0) {
        if (attempts < 12) {
          attempts += 1
          frameID = window.requestAnimationFrame(centerGraph)
        }
        return
      }

      return { canvasHeight, canvasWidth }
    }

    function centerGraph() {
      const canvasSize = readCanvasSize()
      if (!canvasSize) return

      setGraphPanPosition({
        x: Math.max(24, Math.round((canvasSize.canvasWidth - layout.width * graphZoomRef.current) / 2)),
        y: Math.max(24, Math.round((canvasSize.canvasHeight - layout.height * graphZoomRef.current) / 2)),
      })
    }

    if (graphPanLayoutKeyRef.current !== graphLayoutKey) {
      graphPanLayoutKeyRef.current = graphLayoutKey
      const pendingGraphAnchor = pendingGraphAnchorRef.current
      pendingGraphAnchorRef.current = null
      if (pendingGraphAnchor) {
        const anchoredNode = layout.nodes.find((layoutNode) => layoutNode.id === pendingGraphAnchor.messageID)
        graphPanWasUserControlledRef.current = true
        if (anchoredNode) {
          const zoom = graphZoomRef.current
          setGraphPanPosition({
            x: Math.round(pendingGraphAnchor.screenX - anchoredNode.x * zoom),
            y: Math.round(pendingGraphAnchor.screenY - anchoredNode.y * zoom),
          })
        } else {
          centerGraph()
        }
      } else {
        graphPanWasUserControlledRef.current = false
        centerGraph()
      }
    } else if (!graphPanWasUserControlledRef.current) {
      centerGraph()
    }

    if (graphPanWasUserControlledRef.current) {
      return () => {
        if (frameID !== null) {
          window.cancelAnimationFrame(frameID)
        }
      }
    }

    if (typeof ResizeObserver === "undefined") {
      return () => {
        if (frameID !== null) {
          window.cancelAnimationFrame(frameID)
        }
      }
    }

    const resizeObserver = new ResizeObserver(() => {
      if (!graphPanWasUserControlledRef.current) {
        attempts = 0
        centerGraph()
      }
    })
    resizeObserver.observe(canvasElement)

    return () => {
      if (frameID !== null) {
        window.cancelAnimationFrame(frameID)
      }
      resizeObserver.disconnect()
    }
  }, [graphLayout, graphLayoutKey])

  useLayoutEffect(() => {
    if (!graphLayout || !pendingLayoutAnimationSnapshotRef.current) return

    const previousSnapshot = pendingLayoutAnimationSnapshotRef.current
    pendingLayoutAnimationSnapshotRef.current = null

    if (layoutAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(layoutAnimationFrameRef.current)
    }

    layoutAnimationFrameRef.current = window.requestAnimationFrame(() => {
      layoutAnimationFrameRef.current = null
      const graphElement = canvasRef.current?.querySelector<HTMLElement>(".session-message-tree-graph")
      if (!graphElement) return

      const currentPan = graphPanRef.current
      const currentZoom = graphZoomRef.current
      const currentZoomFactor = Number.isFinite(currentZoom) && currentZoom > 0 ? currentZoom : 1
      for (const layoutNode of graphLayout.nodes) {
        const previousPosition = previousSnapshot.positions.get(layoutNode.id)
        if (!previousPosition) continue

        const previousScreenX = previousSnapshot.pan.x + previousPosition.x * previousSnapshot.zoom
        const previousScreenY = previousSnapshot.pan.y + previousPosition.y * previousSnapshot.zoom
        const currentScreenX = currentPan.x + layoutNode.x * currentZoom
        const currentScreenY = currentPan.y + layoutNode.y * currentZoom
        const deltaX = (previousScreenX - currentScreenX) / currentZoomFactor
        const deltaY = (previousScreenY - currentScreenY) / currentZoomFactor
        if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) continue

        const nodeElement = [...graphElement.querySelectorAll<HTMLElement>(".session-message-tree-graph-node")]
          .find((element) => element.dataset.messageTreeNodeId === layoutNode.id)
        if (!nodeElement || typeof nodeElement.animate !== "function") continue

        nodeElement.animate(
          [
            { transform: `translate(calc(-50% + ${deltaX}px), calc(-8px + ${deltaY}px))` },
            { transform: "translate(-50%, -8px)" },
          ],
          {
            duration: MESSAGE_TREE_LAYOUT_ANIMATION_DURATION_MS,
            easing: "cubic-bezier(0.2, 0, 0, 1)",
          },
        )
      }
    })
  }, [graphLayout, graphLayoutKey])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const canvasElement = canvas

    function handleCanvasPointerDown(event: PointerEvent) {
      if (event.button !== 2) return
      if (shouldAllowResponseTextContextMenu(event)) return

      event.preventDefault()
      event.stopPropagation()
      stopCanvasPan()
      canvasPanStateRef.current = {
        pointerID: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startPanX: graphPanRef.current.x,
        startPanY: graphPanRef.current.y,
      }
      graphPanWasUserControlledRef.current = true
      setIsCanvasPanning(true)

      try {
        canvasElement.setPointerCapture(event.pointerId)
      } catch {
        // Pointer capture can fail in tests or if the pointer was already released.
      }

      function handleWindowPointerMove(windowEvent: PointerEvent) {
        updateCanvasPan(windowEvent)
      }

      function handleWindowPointerUp(windowEvent: PointerEvent) {
        if (windowEvent.pointerId === event.pointerId) {
          windowEvent.preventDefault()
          windowEvent.stopPropagation()
          stopCanvasPan()
        }
      }

      window.addEventListener("pointermove", handleWindowPointerMove, true)
      window.addEventListener("pointerup", handleWindowPointerUp, true)
      window.addEventListener("pointercancel", handleWindowPointerUp, true)
      canvasPanCleanupRef.current = () => {
        window.removeEventListener("pointermove", handleWindowPointerMove, true)
        window.removeEventListener("pointerup", handleWindowPointerUp, true)
        window.removeEventListener("pointercancel", handleWindowPointerUp, true)
        canvasPanCleanupRef.current = null
      }
    }

    function handleCanvasPointerMove(event: PointerEvent) {
      updateCanvasPan(event)
    }

    function handleCanvasPointerEnd(event: PointerEvent) {
      const activePan = canvasPanStateRef.current
      if (!activePan || activePan.pointerID !== event.pointerId) return

      event.preventDefault()
      event.stopPropagation()
      stopCanvasPan()
    }

    function handleCanvasContextMenu(event: MouseEvent) {
      if (shouldAllowResponseTextContextMenu(event)) return

      event.preventDefault()
      event.stopPropagation()
    }

    function handleCanvasWheel(event: WheelEvent) {
      if (!event.ctrlKey) return

      event.preventDefault()
      event.stopPropagation()
      stopCanvasPan()

      const currentZoom = graphZoomRef.current
      const nextZoom = clampGraphZoom(currentZoom * Math.exp(-event.deltaY * GRAPH_ZOOM_DELTA_FACTOR))
      if (nextZoom === currentZoom) return

      const rect = canvasElement.getBoundingClientRect()
      const pointerX = event.clientX - rect.left
      const pointerY = event.clientY - rect.top
      const currentPan = graphPanRef.current
      const graphX = (pointerX - currentPan.x) / currentZoom
      const graphY = (pointerY - currentPan.y) / currentZoom
      const nextPan = {
        x: Math.round(pointerX - graphX * nextZoom),
        y: Math.round(pointerY - graphY * nextZoom),
      }

      graphPanWasUserControlledRef.current = true
      setGraphPanPosition(nextPan)
      setGraphZoomValue(nextZoom)
    }

    canvasElement.addEventListener("pointerdown", handleCanvasPointerDown, true)
    canvasElement.addEventListener("pointermove", handleCanvasPointerMove, true)
    canvasElement.addEventListener("pointerup", handleCanvasPointerEnd, true)
    canvasElement.addEventListener("pointercancel", handleCanvasPointerEnd, true)
    canvasElement.addEventListener("contextmenu", handleCanvasContextMenu, true)
    canvasElement.addEventListener("wheel", handleCanvasWheel, { capture: true, passive: false })

    return () => {
      canvasElement.removeEventListener("pointerdown", handleCanvasPointerDown, true)
      canvasElement.removeEventListener("pointermove", handleCanvasPointerMove, true)
      canvasElement.removeEventListener("pointerup", handleCanvasPointerEnd, true)
      canvasElement.removeEventListener("pointercancel", handleCanvasPointerEnd, true)
      canvasElement.removeEventListener("contextmenu", handleCanvasContextMenu, true)
      canvasElement.removeEventListener("wheel", handleCanvasWheel, true)
    }
  }, [])

  if (!session) {
    return (
      <div className="right-sidebar-empty session-message-tree-empty" role="status">
        <p>No session selected.</p>
      </div>
    )
  }

  if (!messageTree || !hasRootNodes) {
    return (
      <div className="right-sidebar-empty session-message-tree-empty" role="status">
        <p>No message tree loaded yet.</p>
      </div>
    )
  }

  const currentSession = session

  function setGraphPanPosition(nextPan: MessageTreeGraphPan) {
    graphPanRef.current = nextPan
    setGraphPan(nextPan)
  }

  function setGraphZoomValue(nextZoom: number) {
    graphZoomRef.current = nextZoom
    setGraphZoom(nextZoom)
  }

  function stopCanvasPan() {
    const activePan = canvasPanStateRef.current
    if (!activePan) return

    const canvas = canvasRef.current
    if (canvas) {
      try {
        canvas.releasePointerCapture(activePan.pointerID)
      } catch {
        // The pointer may already have been released by the browser.
      }
    }
    canvasPanCleanupRef.current?.()
    canvasPanStateRef.current = null
    setIsCanvasPanning(false)
  }

  function updateCanvasPan(event: PointerEvent) {
    const activePan = canvasPanStateRef.current
    if (!activePan || activePan.pointerID !== event.pointerId) return

    if ((event.buttons & 2) === 0) {
      stopCanvasPan()
      return
    }

    event.preventDefault()
    event.stopPropagation()
    setGraphPanPosition({
      x: activePan.startPanX + (event.clientX - activePan.startClientX),
      y: activePan.startPanY + (event.clientY - activePan.startClientY),
    })
  }

  function preserveGraphNodeScreenPosition(messageID: string) {
    const layoutNode = graphLayout?.nodes.find((node) => node.id === messageID)
    if (!layoutNode) {
      pendingGraphAnchorRef.current = null
      return
    }

    const zoom = graphZoomRef.current
    const pan = graphPanRef.current
    pendingGraphAnchorRef.current = {
      messageID,
      screenX: pan.x + layoutNode.x * zoom,
      screenY: pan.y + layoutNode.y * zoom,
    }
  }

  function captureGraphLayoutAnimationPositions() {
    if (!graphLayout) {
      pendingLayoutAnimationSnapshotRef.current = null
      return
    }

    pendingLayoutAnimationSnapshotRef.current = {
      pan: {
        x: graphPanRef.current.x,
        y: graphPanRef.current.y,
      },
      positions: new Map(
        graphLayout.nodes.map((layoutNode) => [
          layoutNode.id,
          {
            x: layoutNode.x,
            y: layoutNode.y,
          },
        ]),
      ),
      zoom: graphZoomRef.current,
    }
  }

  function handleToggleFullExpansion() {
    siblingWheelSwitchRef.current = null
    captureGraphLayoutAnimationPositions()
    pendingGraphAnchorRef.current = null
    setIsFullyExpanded((currentValue) => !currentValue)
  }

  function openExpandedResponse(messageID: string) {
    if (expandedResponseMessageID === messageID) return

    const nextChildResponseMessageIDs = messageTree ? getChildResponseMessageIDs(messageTree, messageID) : []
    siblingWheelSwitchRef.current = null
    captureGraphLayoutAnimationPositions()
    preserveGraphNodeScreenPosition(messageID)
    setExpandedResponseMessageID(messageID)
    setCenteredChildResponseMessageID(getDefaultCenteredChildResponseID(nextChildResponseMessageIDs, activePathSet))
  }

  function collapseExpandedResponse(messageID: string | null = expandedResponseMessageID) {
    siblingWheelSwitchRef.current = null
    captureGraphLayoutAnimationPositions()
    if (messageID) {
      preserveGraphNodeScreenPosition(messageID)
    } else {
      pendingGraphAnchorRef.current = null
    }
    setExpandedResponseMessageID(null)
    setCenteredChildResponseMessageID(null)
  }

  function switchCenteredChildResponseFromWheel(
    event: ReactWheelEvent<HTMLElement>,
    childResponseMessageID: string,
  ) {
    if (event.ctrlKey || !messageTree || !expandedResponseMessageID || childResponseMessageIDs.length <= 1) return

    const wheelDeltaY = normalizeSiblingWheelDeltaY(event)
    if (Math.abs(wheelDeltaY) < 1) return

    event.preventDefault()
    event.stopPropagation()

    const now = typeof performance !== "undefined" ? performance.now() : Date.now()
    const direction = wheelDeltaY > 0 ? 1 : -1
    const previousSwitch = siblingWheelSwitchRef.current
    const isSameGesture = Boolean(
      previousSwitch &&
        previousSwitch.direction === direction &&
        now - previousSwitch.lastWheelAt < SIBLING_WHEEL_GESTURE_RESET_MS,
    )

    if (isSameGesture && previousSwitch?.hasSwitchedInGesture) {
      siblingWheelSwitchRef.current = {
        accumulatedDeltaY: 0,
        direction,
        hasSwitchedInGesture: true,
        lastWheelAt: now,
        messageID: childResponseMessageID,
      }
      return
    }

    const nextAccumulatedDeltaY = (isSameGesture ? previousSwitch?.accumulatedDeltaY ?? 0 : 0) + wheelDeltaY

    siblingWheelSwitchRef.current = {
      accumulatedDeltaY: nextAccumulatedDeltaY,
      direction,
      hasSwitchedInGesture: false,
      lastWheelAt: now,
      messageID: childResponseMessageID,
    }

    if (Math.abs(nextAccumulatedDeltaY) < SIBLING_WHEEL_SWITCH_DELTA) return

    const currentIndex = childResponseMessageIDs.indexOf(
      effectiveCenteredChildResponseMessageID ?? childResponseMessageID,
    )
    const normalizedCurrentIndex = currentIndex >= 0 ? currentIndex : childResponseMessageIDs.indexOf(childResponseMessageID)
    if (normalizedCurrentIndex < 0) return

    const nextIndex = (
      normalizedCurrentIndex +
      direction +
      childResponseMessageIDs.length
    ) % childResponseMessageIDs.length
    const nextChildResponseMessageID = childResponseMessageIDs[nextIndex]
    if (!nextChildResponseMessageID || nextChildResponseMessageID === effectiveCenteredChildResponseMessageID) return

    siblingWheelSwitchRef.current = {
      accumulatedDeltaY: 0,
      direction,
      hasSwitchedInGesture: true,
      lastWheelAt: now,
      messageID: childResponseMessageID,
    }
    captureGraphLayoutAnimationPositions()
    preserveGraphNodeScreenPosition(expandedResponseMessageID)
    setCenteredChildResponseMessageID(nextChildResponseMessageID)
    void onSelectMessage(
      currentSession.id,
      getMessageIDForChildResponseSelection(messageTree, expandedResponseMessageID, nextChildResponseMessageID),
    )
  }

  return (
    <section
      className="session-message-tree-panel"
      aria-label="Session message tree"
      onDoubleClickCapture={(event) => {
        if (!expandedResponseMessageID) return

        const target = event.target
        const targetNodeElement = target instanceof Element
          ? target.closest<HTMLElement>(".session-message-tree-graph-node")
          : null
        const targetMessageID = targetNodeElement?.dataset.messageTreeNodeId ?? null
        const targetNode = targetMessageID ? messageTree.nodesByID[targetMessageID] : undefined

        event.preventDefault()
        event.stopPropagation()

        if (targetMessageID && canExpandMessageTreeNode(targetNode)) {
          openExpandedResponse(targetMessageID)
          return
        }

        collapseExpandedResponse()
      }}
    >
      <header className="session-message-tree-header">
        <div className="session-message-tree-heading-row">
          <div className="session-message-tree-title-copy">
            <span>Session tree</span>
            <h3 title={session.title}>{session.title}</h3>
          </div>
          <button
            type="button"
            className={joinClassNames(
              "session-message-tree-expand-toggle",
              isFullyExpanded && "is-active",
            )}
            aria-label={isFullyExpanded ? "Collapse all tree nodes" : "Expand all tree nodes"}
            aria-pressed={isFullyExpanded}
            title={isFullyExpanded ? "Collapse all tree nodes" : "Expand all tree nodes"}
            onClick={handleToggleFullExpansion}
          >
            {isFullyExpanded ? <MinimizeIcon /> : <ExpandIcon />}
          </button>
        </div>
        <div className="session-message-tree-meta" aria-label="Tree summary">
          <span>{nodeCount} messages</span>
          <span>{branchPointCount} branch points</span>
          {isFullyExpanded ? <span>Fully expanded</span> : null}
        </div>
      </header>

      <div
        ref={canvasRef}
        className={joinClassNames("session-message-tree-canvas", isCanvasPanning && "is-panning")}
      >
        <div
          className="session-message-tree-graph"
          role="tree"
          aria-label={`Message tree for ${currentSession.title}`}
          style={{
            height: graphLayout ? `${graphLayout.height}px` : undefined,
            transform: `matrix(${graphZoom}, 0, 0, ${graphZoom}, ${graphPan.x}, ${graphPan.y})`,
            width: graphLayout ? `${graphLayout.width}px` : undefined,
          }}
        >
          {graphLayout ? (
            <svg
              className="session-message-tree-edges"
              width={graphLayout.width}
              height={graphLayout.height}
              viewBox={`0 0 ${graphLayout.width} ${graphLayout.height}`}
              aria-hidden="true"
            >
              <defs>
                <marker
                  id={markerID}
                  markerHeight="8"
                  markerWidth="8"
                  orient="auto"
                  refX="7"
                  refY="4"
                  viewBox="0 0 8 8"
                >
                  <path className="session-message-tree-edge-arrow" d="M0,0 L8,4 L0,8 Z" />
                </marker>
                <marker
                  id={activeMarkerID}
                  markerHeight="8"
                  markerWidth="8"
                  orient="auto"
                  refX="7"
                  refY="4"
                  viewBox="0 0 8 8"
                >
                  <path className="session-message-tree-edge-arrow is-active-path" d="M0,0 L8,4 L0,8 Z" />
                </marker>
              </defs>
              {graphLayout.edges.map((edge) => (
                <path
                  key={`${edge.fromID}-${edge.toID}`}
                  className={joinClassNames(
                    "session-message-tree-edge",
                    edge.isActivePath && "is-active-path",
                  )}
                  d={buildEdgePath(edge)}
                  markerEnd={`url(#${edge.isActivePath ? activeMarkerID : markerID})`}
                />
              ))}
            </svg>
          ) : null}

          {graphLayout?.nodes.map((layoutNode) => {
            const node = messageTree.nodesByID[layoutNode.id]
            if (!node) return null

            const isActive = node.id === messageTree.activeMessageID
            const isActivePath = activePathSet.has(node.id)
            const canExpandResponse = canExpandMessageTreeNode(node)
            const isExpandedResponse = expandedResponseMessageIDs.has(node.id) && canExpandResponse
            const isSiblingWheelTarget = effectiveCenteredChildResponseMessageID === node.id &&
              childResponseMessageIDs.length > 1
            const nodeStyle: MessageTreeGraphNodeStyle = {
              left: `${layoutNode.x}px`,
              top: `${layoutNode.y}px`,
            }

            if (isExpandedResponse) {
              nodeStyle["--session-message-tree-expanded-node-width"] = `${layoutNode.width}px`
              nodeStyle["--session-message-tree-expanded-node-height"] = `${layoutNode.height}px`
              nodeStyle["--session-message-tree-response-card-height"] = `${
                layoutNode.cardHeight ?? Math.max(EXPANDED_RESPONSE_CARD_MIN_HEIGHT, layoutNode.height - EXPANDED_RESPONSE_NODE_CHROME_HEIGHT)
              }px`
              nodeStyle["--session-message-tree-response-card-width"] = `${layoutNode.cardWidth ?? EXPANDED_RESPONSE_CARD_MIN_WIDTH}px`
              nodeStyle["--session-message-tree-response-card-min-height"] = `${
                Math.max(EXPANDED_RESPONSE_CARD_MIN_HEIGHT, layoutNode.height - EXPANDED_RESPONSE_NODE_CHROME_HEIGHT)
              }px`
            }

            return (
              <div
                key={node.id}
                role="treeitem"
                aria-disabled={isActive ? "true" : undefined}
                aria-current={isActive ? "true" : undefined}
                aria-expanded={canExpandResponse ? isExpandedResponse : undefined}
                aria-level={layoutNode.depth + 1}
                className={joinClassNames(
                  "session-message-tree-graph-node session-message-tree-row",
                  `is-${node.role}`,
                  isActivePath && "is-active-path",
                  isActive && "is-active",
                  isExpandedResponse && "is-expanded-response",
                  isSiblingWheelTarget && "is-sibling-wheel-target",
                )}
                style={nodeStyle}
                data-message-tree-node-id={node.id}
                tabIndex={0}
                title={isExpandedResponse ? undefined : node.preview}
                onClick={(event) => {
                  if (event.button !== 0) return
                  if (canExpandResponse) {
                    openExpandedResponse(node.id)
                  }
                  if (!isActive) {
                    void onSelectMessage(currentSession.id, node.id)
                  }
                }}
                onDoubleClick={(event) => {
                  if (!canExpandResponse) return
                  event.preventDefault()
                  event.stopPropagation()
                  openExpandedResponse(node.id)
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && isExpandedResponse) {
                    event.preventDefault()
                    collapseExpandedResponse(node.id)
                    return
                  }

                  if (event.key !== "Enter" && event.key !== " ") return
                  event.preventDefault()
                  if (canExpandResponse) {
                    openExpandedResponse(node.id)
                  }
                  if (!isActive) {
                    void onSelectMessage(currentSession.id, node.id)
                  }
                }}
                onWheel={isSiblingWheelTarget ? (event) => switchCenteredChildResponseFromWheel(event, node.id) : undefined}
              >
                <span className="session-message-tree-dot" aria-hidden="true" />
                {isExpandedResponse ? (
                  <div className="session-message-tree-response-card">
                    <div className="session-message-tree-response-card-header">
                      <span className="session-message-tree-response-card-title">Response</span>
                      <div className="session-message-tree-response-card-actions">
                        {node.isCompletedResponse && onOpenBranchChat ? (
                          <button
                            type="button"
                            className="session-message-tree-response-branch-chat"
                            aria-label={t("branchChat.action.openResponse")}
                            title={t("branchChat.action.open")}
                            onClick={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              onOpenBranchChat(node.id)
                            }}
                          >
                            <ForkIcon />
                          </button>
                        ) : null}
                        {isFullyExpanded ? null : (
                          <button
                            type="button"
                            className="session-message-tree-response-collapse"
                            aria-label="Collapse response"
                            onClick={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              collapseExpandedResponse(node.id)
                            }}
                          >
                            <span aria-hidden="true">{"\u00d7"}</span>
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="session-message-tree-response-card-main">
                      <div
                        className="session-message-tree-response-card-body-wrap"
                        onWheel={(event) => {
                          event.stopPropagation()
                        }}
                      >
                        <ThreadMarkdown
                          className="session-message-tree-response-card-body thread-markdown"
                          text={node.content}
                          onArtifactLinkOpen={onArtifactLinkOpen}
                          onLocalFileLinkOpen={onLocalFileLinkOpen}
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <span className="session-message-tree-node-preview">{node.preview}</span>
                    {node.role === "assistant" && node.isCompletedResponse && onOpenBranchChat ? (
                      <button
                        type="button"
                        className="session-message-tree-node-branch-chat"
                        aria-label={t("branchChat.action.openNamed", { preview: node.preview })}
                        title={t("branchChat.action.open")}
                        onClick={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          onOpenBranchChat(node.id)
                        }}
                      >
                        <ForkIcon />
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
