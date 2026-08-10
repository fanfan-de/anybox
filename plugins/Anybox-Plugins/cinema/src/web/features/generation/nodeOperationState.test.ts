import { describe, expect, it } from "vitest"
import {
  createNodeOperationState,
  isNodeOperationPending,
  nodeOperationError,
  nodeOperationReducer,
} from "./nodeOperationState"

describe("nodeOperationReducer", () => {
  it("tracks concurrent nodes independently", () => {
    let state = createNodeOperationState()
    state = nodeOperationReducer(state, { type: "begin", nodeID: "text-a" })
    state = nodeOperationReducer(state, { type: "begin", nodeID: "text-b" })
    state = nodeOperationReducer(state, { type: "settle", nodeID: "text-a" })

    expect(isNodeOperationPending(state, "text-a")).toBe(false)
    expect(isNodeOperationPending(state, "text-b")).toBe(true)
  })

  it("keeps failures attached to their node", () => {
    let state = createNodeOperationState()
    state = nodeOperationReducer(state, { type: "begin", nodeID: "image-a" })
    state = nodeOperationReducer(state, { type: "begin", nodeID: "image-b" })
    state = nodeOperationReducer(state, { type: "fail", nodeID: "image-a", message: "Provider failed" })
    state = nodeOperationReducer(state, { type: "settle", nodeID: "image-a" })

    expect(nodeOperationError(state, "image-a")).toBe("Provider failed")
    expect(nodeOperationError(state, "image-b")).toBeNull()
    expect(isNodeOperationPending(state, "image-b")).toBe(true)
  })

  it("uses a reference count for overlapping work on the same node", () => {
    let state = createNodeOperationState()
    state = nodeOperationReducer(state, { type: "begin", nodeID: "api-a" })
    state = nodeOperationReducer(state, { type: "begin", nodeID: "api-a" })
    state = nodeOperationReducer(state, { type: "settle", nodeID: "api-a" })

    expect(isNodeOperationPending(state, "api-a")).toBe(true)

    state = nodeOperationReducer(state, { type: "settle", nodeID: "api-a" })
    expect(isNodeOperationPending(state, "api-a")).toBe(false)
  })

  it("clears one error without disturbing another node and can reset the registry", () => {
    let state = createNodeOperationState()
    state = nodeOperationReducer(state, { type: "fail", nodeID: "video-a", message: "A failed" })
    state = nodeOperationReducer(state, { type: "fail", nodeID: "video-b", message: "B failed" })
    state = nodeOperationReducer(state, { type: "clear-error", nodeID: "video-a" })

    expect(nodeOperationError(state, "video-a")).toBeNull()
    expect(nodeOperationError(state, "video-b")).toBe("B failed")

    state = nodeOperationReducer(state, { type: "reset" })
    expect(nodeOperationError(state, "video-b")).toBeNull()
    expect(state.pendingCounts.size).toBe(0)
  })
})
