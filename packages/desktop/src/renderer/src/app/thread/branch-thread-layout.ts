import type { SessionMessageTree } from "../session-message-tree"

const BRANCH_NODE_WIDTH = 196
const BRANCH_NODE_HEIGHT = 72
const BRANCH_COLUMN_GAP = 44
const BRANCH_DEPTH_GAP = 54
const BRANCH_GRAPH_PADDING = 40

export interface BranchThreadLayoutNode {
  column: number
  depth: number
  height: number
  id: string
  width: number
  x: number
  y: number
}

export interface BranchThreadLayoutEdge {
  fromID: string
  fromX: number
  fromY: number
  isActivePath: boolean
  toID: string
  toX: number
  toY: number
}

export interface BranchThreadLayout {
  edges: BranchThreadLayoutEdge[]
  height: number
  nodeIDsInNavigationOrder: string[]
  nodes: BranchThreadLayoutNode[]
  width: number
}

export function buildBranchThreadLayout(messageTree: SessionMessageTree): BranchThreadLayout | null {
  const activePathSet = new Set(messageTree.activePathMessageIDs)
  const nodesByID = new Map<string, BranchThreadLayoutNode>()
  const edges: BranchThreadLayoutEdge[] = []
  const nodeIDsInNavigationOrder: string[] = []
  const visited = new Set<string>()
  let nextColumn = 0
  let maxDepth = 0

  function visit(messageID: string, depth: number): number | null {
    if (visited.has(messageID) || !messageTree.nodesByID[messageID]) return null
    visited.add(messageID)
    nodeIDsInNavigationOrder.push(messageID)
    maxDepth = Math.max(maxDepth, depth)

    const childColumns: number[] = []
    for (const childID of messageTree.childIDsByParentID[messageID] ?? []) {
      const childColumn = visit(childID, depth + 1)
      if (childColumn !== null) childColumns.push(childColumn)
    }

    const column = childColumns.length > 0
      ? childColumns.reduce((total, value) => total + value, 0) / childColumns.length
      : nextColumn++

    nodesByID.set(messageID, {
      column,
      depth,
      height: BRANCH_NODE_HEIGHT,
      id: messageID,
      width: BRANCH_NODE_WIDTH,
      x: BRANCH_GRAPH_PADDING + column * (BRANCH_NODE_WIDTH + BRANCH_COLUMN_GAP),
      y: BRANCH_GRAPH_PADDING + depth * (BRANCH_NODE_HEIGHT + BRANCH_DEPTH_GAP),
    })
    return column
  }

  for (const rootMessageID of messageTree.rootMessageIDs) {
    visit(rootMessageID, 0)
  }

  if (nodesByID.size === 0) return null

  for (const node of nodesByID.values()) {
    for (const childID of messageTree.childIDsByParentID[node.id] ?? []) {
      const child = nodesByID.get(childID)
      if (!child) continue
      edges.push({
        fromID: node.id,
        fromX: node.x + BRANCH_NODE_WIDTH / 2,
        fromY: node.y + BRANCH_NODE_HEIGHT,
        isActivePath: activePathSet.has(node.id) && activePathSet.has(childID),
        toID: childID,
        toX: child.x + BRANCH_NODE_WIDTH / 2,
        toY: child.y,
      })
    }
  }

  const nodes = [...nodesByID.values()].sort((left, right) => (
    left.depth === right.depth
      ? left.column - right.column
      : left.depth - right.depth
  ))
  const maxX = Math.max(...nodes.map((node) => node.x + node.width))

  return {
    edges,
    height: BRANCH_GRAPH_PADDING * 2 + (maxDepth + 1) * BRANCH_NODE_HEIGHT + maxDepth * BRANCH_DEPTH_GAP,
    nodeIDsInNavigationOrder,
    nodes,
    width: maxX + BRANCH_GRAPH_PADDING,
  }
}

