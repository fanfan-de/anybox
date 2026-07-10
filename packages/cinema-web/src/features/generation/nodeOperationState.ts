export type NodeOperationState = {
  pendingCounts: ReadonlyMap<string, number>
  errorsByNodeID: ReadonlyMap<string, string>
}

export type NodeOperationAction =
  | { type: "begin"; nodeID: string }
  | { type: "fail"; nodeID: string; message: string }
  | { type: "settle"; nodeID: string }
  | { type: "clear-error"; nodeID: string }
  | { type: "reset" }

export function createNodeOperationState(): NodeOperationState {
  return {
    pendingCounts: new Map(),
    errorsByNodeID: new Map(),
  }
}

export function nodeOperationReducer(
  state: NodeOperationState,
  action: NodeOperationAction,
): NodeOperationState {
  if (action.type === "reset") return createNodeOperationState()

  const pendingCounts = new Map(state.pendingCounts)
  const errorsByNodeID = new Map(state.errorsByNodeID)

  if (action.type === "begin") {
    pendingCounts.set(action.nodeID, (pendingCounts.get(action.nodeID) ?? 0) + 1)
    errorsByNodeID.delete(action.nodeID)
  } else if (action.type === "fail") {
    errorsByNodeID.set(action.nodeID, action.message)
  } else if (action.type === "settle") {
    const nextCount = (pendingCounts.get(action.nodeID) ?? 0) - 1
    if (nextCount > 0) pendingCounts.set(action.nodeID, nextCount)
    else pendingCounts.delete(action.nodeID)
  } else {
    errorsByNodeID.delete(action.nodeID)
  }

  return { pendingCounts, errorsByNodeID }
}

export function isNodeOperationPending(state: NodeOperationState, nodeID: string) {
  return (state.pendingCounts.get(nodeID) ?? 0) > 0
}

export function nodeOperationError(state: NodeOperationState, nodeID: string) {
  return state.errorsByNodeID.get(nodeID) ?? null
}
