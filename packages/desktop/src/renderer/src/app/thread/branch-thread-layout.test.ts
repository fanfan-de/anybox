import { describe, expect, it } from "vitest"
import type { SessionMessageTree, SessionMessageTreeNode } from "../session-message-tree"
import { buildBranchThreadLayout } from "./branch-thread-layout"

function createNode(
  id: string,
  role: SessionMessageTreeNode["role"],
  parentMessageID: string | null,
  created: number,
): SessionMessageTreeNode {
  return {
    id,
    sessionID: "session-1",
    role,
    parentMessageID,
    created,
    content: id,
    preview: id,
  }
}

function createTree(): SessionMessageTree {
  const nodes = [
    createNode("user-1", "user", null, 1),
    createNode("assistant-1", "assistant", "user-1", 2),
    createNode("user-left", "user", "assistant-1", 3),
    createNode("assistant-left", "assistant", "user-left", 4),
    createNode("user-right", "user", "assistant-1", 5),
    createNode("assistant-right", "assistant", "user-right", 6),
  ]

  return {
    activeMessageID: "assistant-right",
    activePathMessageIDs: ["user-1", "assistant-1", "user-right", "assistant-right"],
    branchOptionsByParentID: {},
    childIDsByParentID: {
      "user-1": ["assistant-1"],
      "assistant-1": ["user-left", "user-right"],
      "user-left": ["assistant-left"],
      "user-right": ["assistant-right"],
    },
    nodesByID: Object.fromEntries(nodes.map((node) => [node.id, node])),
    rootMessageIDs: ["user-1"],
    sessionID: "session-1",
  }
}

describe("branch thread layout", () => {
  it("centers parents over child columns and marks only active-path edges", () => {
    const layout = buildBranchThreadLayout(createTree())
    expect(layout).not.toBeNull()

    const byID = new Map(layout?.nodes.map((node) => [node.id, node]))
    const left = byID.get("user-left")
    const right = byID.get("user-right")
    const parent = byID.get("assistant-1")

    expect(parent?.column).toBe((left!.column + right!.column) / 2)
    expect(left?.x).toBeLessThan(right!.x)
    expect(layout?.edges.find((edge) => edge.toID === "user-left")?.isActivePath).toBe(false)
    expect(layout?.edges.find((edge) => edge.toID === "user-right")?.isActivePath).toBe(true)
  })

  it("returns null for an empty projection", () => {
    expect(buildBranchThreadLayout({
      activeMessageID: null,
      activePathMessageIDs: [],
      branchOptionsByParentID: {},
      childIDsByParentID: {},
      nodesByID: {},
      rootMessageIDs: [],
      sessionID: "session-1",
    })).toBeNull()
  })
})
