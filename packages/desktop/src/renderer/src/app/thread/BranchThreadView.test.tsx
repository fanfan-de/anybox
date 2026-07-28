import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { SessionMessageTree, SessionMessageTreeNode } from "../session-message-tree"
import { BranchThreadView } from "./BranchThreadView"

function createNode(input: {
  content: string
  created: number
  id: string
  parentMessageID: string | null
  role: SessionMessageTreeNode["role"]
}): SessionMessageTreeNode {
  return {
    ...input,
    sessionID: "session-1",
    preview: input.content,
  }
}

function createTree(): SessionMessageTree {
  const nodes = [
    createNode({ id: "user-1", role: "user", parentMessageID: null, created: 1, content: "Start here" }),
    createNode({ id: "assistant-1", role: "assistant", parentMessageID: "user-1", created: 2, content: "Base answer" }),
    createNode({ id: "user-left", role: "user", parentMessageID: "assistant-1", created: 3, content: "Try the small change" }),
    createNode({ id: "assistant-left", role: "assistant", parentMessageID: "user-left", created: 4, content: "Small result" }),
    createNode({ id: "user-right", role: "user", parentMessageID: "assistant-1", created: 5, content: "Try the larger change" }),
    createNode({ id: "assistant-right", role: "assistant", parentMessageID: "user-right", created: 6, content: "Large result" }),
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

describe("BranchThreadView", () => {
  it("inspects a historical node without changing the current branch marker", () => {
    const onInspectMessage = vi.fn()
    const onContinueFromMessage = vi.fn()
    render(
      <BranchThreadView
        messageTree={createTree()}
        onContinueFromMessage={onContinueFromMessage}
        onInspectMessage={onInspectMessage}
      />,
    )

    const currentNode = screen.getByRole("treeitem", { name: /Large result, Current/ })
    const historicalNode = screen.getByRole("treeitem", { name: /Small result/ })
    expect(currentNode).toHaveAttribute("aria-current", "true")
    expect(currentNode).toHaveAttribute("aria-selected", "true")

    fireEvent.click(historicalNode)

    expect(historicalNode).toHaveAttribute("aria-selected", "true")
    expect(historicalNode).not.toHaveAttribute("aria-current")
    expect(currentNode).toHaveAttribute("aria-current", "true")
    expect(currentNode).toHaveAttribute("aria-selected", "false")
    expect(onInspectMessage).toHaveBeenCalledWith("assistant-left")
    expect(onContinueFromMessage).not.toHaveBeenCalled()
    expect(screen.queryByRole("complementary", { name: "Inspected message detail" })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Continue main thread from selected message" }))
    expect(onContinueFromMessage).toHaveBeenCalledWith("assistant-left")
  })

  it("supports parent and child keyboard navigation without inspecting on focus", () => {
    render(<BranchThreadView messageTree={createTree()} />)

    const child = screen.getByRole("treeitem", { name: /Small result/ })
    const parent = screen.getByRole("treeitem", { name: /Try the small change/ })
    child.focus()
    fireEvent.keyDown(child, { key: "ArrowLeft" })

    expect(parent).toHaveFocus()
    expect(screen.getByRole("treeitem", { name: /Large result, Current/ })).toHaveAttribute(
      "aria-selected",
      "true",
    )
  })
})
