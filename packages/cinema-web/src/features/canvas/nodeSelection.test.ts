import { describe, expect, it } from "vitest"
import {
  hasMultiSelectModifier,
  preserveNodeSelection,
  shouldDeferSingleSelection,
  toggleNodeSelection,
} from "./nodeSelection"

type TestNode = {
  id: string
  selected?: boolean
  label: string
}

describe("preserveNodeSelection", () => {
  it("preserves selected and deselected states for nodes that still exist", () => {
    const current: TestNode[] = [
      { id: "selected", selected: true, label: "Old selected" },
      { id: "deselected", selected: false, label: "Old deselected" },
    ]
    const next: TestNode[] = [
      { id: "selected", label: "Updated selected" },
      { id: "deselected", label: "Updated deselected" },
    ]

    const result = preserveNodeSelection(current, next)

    expect(result).toEqual([
      { id: "selected", selected: true, label: "Updated selected" },
      { id: "deselected", selected: false, label: "Updated deselected" },
    ])
    expect(current).toEqual([
      { id: "selected", selected: true, label: "Old selected" },
      { id: "deselected", selected: false, label: "Old deselected" },
    ])
    expect(next).toEqual([
      { id: "selected", label: "Updated selected" },
      { id: "deselected", label: "Updated deselected" },
    ])
  })

  it("prunes selection state for deleted nodes and keeps new node state", () => {
    const current: TestNode[] = [
      { id: "deleted", selected: true, label: "Deleted" },
      { id: "kept", selected: true, label: "Kept" },
    ]
    const next: TestNode[] = [
      { id: "kept", label: "Updated kept" },
      { id: "added", selected: false, label: "Added" },
    ]

    expect(preserveNodeSelection(current, next)).toEqual([
      { id: "kept", selected: true, label: "Updated kept" },
      { id: "added", selected: false, label: "Added" },
    ])
  })

  it("does not replace an explicit false selection with undefined", () => {
    const current: TestNode[] = [
      { id: "node", selected: false, label: "Old" },
    ]
    const next: TestNode[] = [
      { id: "node", label: "Updated" },
    ]

    expect(preserveNodeSelection(current, next)[0]?.selected).toBe(false)
  })

  it("selects a preferred node introduced by a refreshed canvas", () => {
    const current: TestNode[] = [
      { id: "draft", selected: true, label: "Draft" },
    ]
    const next: TestNode[] = [
      { id: "generated", label: "Generated" },
      { id: "other", selected: true, label: "Other" },
    ]

    expect(preserveNodeSelection(current, next, "generated")).toEqual([
      { id: "generated", selected: true, label: "Generated" },
      { id: "other", selected: false, label: "Other" },
    ])
  })
})

describe("hasMultiSelectModifier", () => {
  it("recognizes the Ctrl modifier", () => {
    expect(hasMultiSelectModifier({ ctrlKey: true, metaKey: false })).toBe(true)
  })

  it("recognizes the Meta modifier", () => {
    expect(hasMultiSelectModifier({ ctrlKey: false, metaKey: true })).toBe(true)
  })

  it("rejects events without Ctrl or Meta", () => {
    expect(hasMultiSelectModifier({ ctrlKey: false, metaKey: false })).toBe(false)
  })
})

describe("toggleNodeSelection", () => {
  it("adds an unselected node without modifying the input", () => {
    const selectedNodeIDs = new Set(["first"])

    const result = toggleNodeSelection(selectedNodeIDs, "second")

    expect(result).toEqual(new Set(["first", "second"]))
    expect(result).not.toBe(selectedNodeIDs)
    expect(selectedNodeIDs).toEqual(new Set(["first"]))
  })

  it("removes a selected node without modifying the input", () => {
    const selectedNodeIDs = new Set(["first", "second"])

    const result = toggleNodeSelection(selectedNodeIDs, "first")

    expect(result).toEqual(new Set(["second"]))
    expect(result).not.toBe(selectedNodeIDs)
    expect(selectedNodeIDs).toEqual(new Set(["first", "second"]))
  })
})

describe("shouldDeferSingleSelection", () => {
  it("keeps a selected group intact until a pointer gesture becomes a click", () => {
    expect(shouldDeferSingleSelection(["first", "second"], "first")).toBe(true)
  })

  it("does not defer an already single selection", () => {
    expect(shouldDeferSingleSelection(["first"], "first")).toBe(false)
  })

  it("does not defer selection for a node outside the selected group", () => {
    expect(shouldDeferSingleSelection(["first", "second"], "third")).toBe(false)
  })
})
