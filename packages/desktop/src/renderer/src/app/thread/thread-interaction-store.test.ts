import { describe, expect, it, vi } from "vitest"
import {
  createThreadInteractionStore,
  selectThreadInteractionEntry,
  type ThreadOperationToken,
} from "./thread-interaction-store"

function entry(
  store: ReturnType<typeof createThreadInteractionStore>,
  scopeID: string,
  rowID: string,
) {
  return selectThreadInteractionEntry(store.getState(), scopeID, rowID)
}

describe("thread interaction store", () => {
  it("isolates question state by scope and row", () => {
    const store = createThreadInteractionStore()

    store.getState().setQuestionDraft("main", "question-1", "Main answer")
    store.getState().setQuestionSelectedOptions("main", "question-1", ["a", "b", "a"])
    store.getState().setQuestionDraft("secondary-scope", "question-1", "Side answer")

    expect(entry(store, "main", "question-1")?.question).toEqual({
      draft: "Main answer",
      selectedOptions: ["a", "b"],
    })
    expect(entry(store, "secondary-scope", "question-1")?.question).toEqual({
      draft: "Side answer",
      selectedOptions: [],
    })
    expect(entry(store, "main", "question-2")).toBeNull()
  })

  it("uses an atomic token to reject duplicate and stale operation results", () => {
    const store = createThreadInteractionStore()

    const firstToken = store.getState().beginOperation("main", "question-1")
    expect(firstToken).not.toBeNull()
    expect(store.getState().beginOperation("main", "question-1")).toBeNull()
    expect(entry(store, "main", "question-1")?.operation).toEqual({
      error: null,
      status: "submitting",
      token: firstToken,
    })

    expect(store.getState().completeOperation("main", "question-1", "stale" as ThreadOperationToken)).toBe(false)
    expect(store.getState().completeOperation("main", "question-1", firstToken!)).toBe(true)
    expect(store.getState().beginOperation("main", "question-1")).toBeNull()
    expect(entry(store, "main", "question-1")?.operation.status).toBe("submitted")

    store.getState().resetOperation("main", "question-1")
    const secondToken = store.getState().beginOperation("main", "question-1")
    expect(secondToken).not.toBeNull()
    expect(secondToken).not.toBe(firstToken)
    expect(store.getState().failOperation("main", "question-1", firstToken!, "Old failure")).toBe(false)
    expect(store.getState().failOperation("main", "question-1", secondToken!, "Network failure")).toBe(true)
    expect(entry(store, "main", "question-1")?.operation).toEqual({
      error: "Network failure",
      status: "failed",
      token: secondToken,
    })
  })

  it("allows a failed operation to retry with a fresh token", () => {
    const store = createThreadInteractionStore()
    const firstToken = store.getState().beginOperation("main", "question-1")!

    expect(store.getState().failOperation("main", "question-1", firstToken, "Rejected")).toBe(true)
    const retryToken = store.getState().beginOperation("main", "question-1")

    expect(retryToken).not.toBeNull()
    expect(retryToken).not.toBe(firstToken)
    expect(entry(store, "main", "question-1")?.operation).toEqual({
      error: null,
      status: "submitting",
      token: retryToken,
    })
  })

  it("persists a plan cancellation independently for each row", () => {
    const store = createThreadInteractionStore()

    store.getState().setPlanCancelled("main", "plan-1", true)

    expect(entry(store, "main", "plan-1")?.planCancelled).toBe(true)
    expect(entry(store, "main", "plan-2")).toBeNull()
    store.getState().setPlanCancelled("main", "plan-1", false)
    expect(entry(store, "main", "plan-1")?.planCancelled).toBe(false)
  })

  it("resets durable interaction state only when the content revision changes", () => {
    const store = createThreadInteractionStore()

    store.getState().ensureRevision("main", "question-1", "revision-a")
    store.getState().setQuestionDraft("main", "question-1", "Draft")
    store.getState().setPlanCancelled("main", "question-1", true)
    const operationToken = store.getState().beginOperation("main", "question-1")!
    store.getState().completeOperation("main", "question-1", operationToken)

    store.getState().ensureRevision("main", "question-1", "revision-a")
    expect(entry(store, "main", "question-1")?.question.draft).toBe("Draft")
    expect(entry(store, "main", "question-1")?.operation.status).toBe("submitted")

    store.getState().ensureRevision("main", "question-1", "revision-b")
    expect(entry(store, "main", "question-1")).toMatchObject({
      operation: { status: "idle" },
      planCancelled: false,
      question: { draft: "", selectedOptions: [] },
      revision: "revision-b",
    })
  })

  it("tracks focus without requiring an entry and ignores a stale blur", () => {
    const store = createThreadInteractionStore()

    store.getState().focusRow("main", "question-1")
    expect(store.getState().focusedRow).toEqual({ scopeID: "main", rowID: "question-1" })
    expect(entry(store, "main", "question-1")).toBeNull()

    store.getState().clearRow("other", "question-1")
    expect(store.getState().focusedRow).toEqual({ scopeID: "main", rowID: "question-1" })
    store.getState().clearRow("main", "question-1")
    expect(store.getState().focusedRow).toBeNull()

    store.getState().focusRow("main", "question-1")
    store.getState().focusRow("secondary-scope", "question-2")
    store.getState().blurRow("main", "question-1")
    expect(store.getState().focusedRow).toEqual({ scopeID: "secondary-scope", rowID: "question-2" })
    store.getState().blurRow("secondary-scope", "question-2")
    expect(store.getState().focusedRow).toBeNull()

    store.getState().focusRow("secondary-scope", "question-2")
    store.getState().clearScope("secondary-scope")
    expect(store.getState().focusedRow).toBeNull()
  })

  it("reconciles stale rows in one scope without disturbing another", () => {
    const store = createThreadInteractionStore()
    store.getState().setQuestionDraft("main", "keep", "Keep")
    store.getState().setQuestionDraft("main", "remove", "Remove")
    store.getState().setQuestionDraft("secondary-scope", "remove", "Different scope")
    store.getState().focusRow("main", "remove")

    store.getState().reconcileScope("main", ["keep"])

    expect(entry(store, "main", "keep")?.question.draft).toBe("Keep")
    expect(entry(store, "main", "remove")).toBeNull()
    expect(entry(store, "secondary-scope", "remove")?.question.draft).toBe("Different scope")
    expect(store.getState().focusedRow).toBeNull()
  })

  it("evicts the least recently touched settled entry", () => {
    const store = createThreadInteractionStore({ maxEntries: 2 })
    store.getState().setQuestionDraft("main", "a", "A")
    store.getState().setQuestionDraft("main", "b", "B")
    store.getState().setQuestionDraft("main", "a", "A touched")
    store.getState().setQuestionDraft("main", "c", "C")

    expect(entry(store, "main", "a")?.question.draft).toBe("A touched")
    expect(entry(store, "main", "b")).toBeNull()
    expect(entry(store, "main", "c")?.question.draft).toBe("C")
    expect(store.getState().entries.size).toBe(2)
  })

  it("keeps submitting and submitted operations addressable until reconciliation", () => {
    const store = createThreadInteractionStore({ maxEntries: 1 })
    const firstToken = store.getState().beginOperation("main", "a")!
    const secondToken = store.getState().beginOperation("main", "b")!

    expect(store.getState().entries.size).toBe(2)
    expect(store.getState().completeOperation("main", "a", firstToken)).toBe(true)
    expect(entry(store, "main", "a")?.operation.status).toBe("submitted")
    expect(store.getState().beginOperation("main", "a")).toBeNull()
    expect(entry(store, "main", "b")?.operation.token).toBe(secondToken)
    expect(store.getState().entries.size).toBe(2)

    store.getState().reconcileScope("main", ["b"])

    expect(entry(store, "main", "a")).toBeNull()
    expect(store.getState().entries.size).toBe(1)
  })

  it("does not evict the focused row while applying the LRU limit", () => {
    const store = createThreadInteractionStore({ maxEntries: 1 })
    store.getState().setQuestionDraft("main", "focused", "Unsaved answer")
    store.getState().focusRow("main", "focused")

    store.getState().setQuestionDraft("main", "background", "Background answer")

    expect(entry(store, "main", "focused")?.question.draft).toBe("Unsaved answer")
    expect(entry(store, "main", "background")).toBeNull()
  })

  it("does not notify subscribers for duplicate operations or no-op updates", () => {
    const store = createThreadInteractionStore()
    const listener = vi.fn()
    store.subscribe(listener)

    store.getState().setQuestionDraft("main", "question-1", "Draft")
    store.getState().setQuestionDraft("main", "question-1", "Draft")
    store.getState().setQuestionSelectedOptions("main", "question-1", ["a"])
    store.getState().setQuestionSelectedOptions("main", "question-1", ["a", "a"])
    store.getState().beginOperation("main", "question-1")
    store.getState().beginOperation("main", "question-1")

    expect(listener).toHaveBeenCalledTimes(3)
  })

  it("clears all entries and makes stale completion tokens harmless", () => {
    const store = createThreadInteractionStore()
    const staleToken = store.getState().beginOperation("main", "question-1")!
    store.getState().focusRow("main", "question-1")

    store.getState().clearAll()

    expect(store.getState().entries.size).toBe(0)
    expect(store.getState().focusedRow).toBeNull()
    expect(store.getState().completeOperation("main", "question-1", staleToken)).toBe(false)
    expect(entry(store, "main", "question-1")).toBeNull()
  })
})
