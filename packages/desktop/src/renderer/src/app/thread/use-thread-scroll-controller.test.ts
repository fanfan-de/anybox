import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  useThreadScrollController,
  type ThreadScrollSnapshot,
} from "./use-thread-scroll-controller"

function rect(top: number, height: number, width = 400): DOMRect {
  return {
    bottom: top + height,
    height,
    left: 0,
    right: width,
    top,
    width,
    x: 0,
    y: top,
    toJSON: () => ({}),
  }
}

function setScrollMetrics(
  threadColumn: HTMLDivElement,
  { clientHeight = 400, scrollHeight = 2_000, scrollTop = 0 } = {},
) {
  Object.defineProperty(threadColumn, "clientHeight", { configurable: true, value: clientHeight })
  Object.defineProperty(threadColumn, "scrollHeight", { configurable: true, value: scrollHeight })
  threadColumn.scrollTop = scrollTop
  vi.spyOn(threadColumn, "getBoundingClientRect").mockImplementation(() => rect(0, clientHeight))
}

function appendVirtualRow(
  threadColumn: HTMLDivElement,
  rowID: string,
  readDocumentTop: () => number,
) {
  const row = document.createElement("div")
  row.setAttribute("data-thread-virtual-row-id", rowID)
  vi.spyOn(row, "getBoundingClientRect").mockImplementation(() => (
    rect(readDocumentTop() - threadColumn.scrollTop, 40)
  ))
  threadColumn.append(row)
  return row
}

function installAnimationFrameQueue() {
  let nextFrameID = 1
  const frames = new Map<number, FrameRequestCallback>()
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const frameID = nextFrameID
    nextFrameID += 1
    frames.set(frameID, callback)
    return frameID
  })
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((frameID) => {
    frames.delete(frameID)
  })

  return {
    flush() {
      const pendingFrames = Array.from(frames.values())
      frames.clear()
      for (const callback of pendingFrames) callback(performance.now())
    },
    size() {
      return frames.size
    },
  }
}

function renderScrollController(
  threadColumn: HTMLDivElement,
  options: {
    readScrollSnapshot?: (key: string) => ThreadScrollSnapshot | null
    saveScrollSnapshot?: (key: string, snapshot: ThreadScrollSnapshot) => void
  } = {},
) {
  const getLatestThreadContentScrollTarget = vi.fn((column: HTMLDivElement) => ({
    scrollTop: column.scrollTop,
    visualScrollTop: column.scrollTop,
  }))
  const threadColumnRef = { current: threadColumn }
  const hook = renderHook(() => useThreadScrollController({
    getLatestThreadContentScrollTarget,
    isSidebarResizeInProgress: () => false,
    readScrollSnapshot: options.readScrollSnapshot,
    saveScrollSnapshot: options.saveScrollSnapshot,
    scrollStateKey: "session:scroll-controller-test",
    threadColumnRef,
  }))
  return { ...hook, getLatestThreadContentScrollTarget }
}

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe("useThreadScrollController projection layout transactions", () => {
  it("transfers a disappearing source row's viewport offset to a surviving anchor in two frames", () => {
    const animationFrames = installAnimationFrameQueue()
    const threadColumn = document.createElement("div")
    threadColumn.className = "thread-column"
    document.body.append(threadColumn)
    setScrollMetrics(threadColumn, { scrollTop: 500 })

    let sourceDocumentTop = 620
    let anchorDocumentTop = 620
    const source = appendVirtualRow(threadColumn, "process:row", () => sourceDocumentTop)
    const anchor = appendVirtualRow(threadColumn, "turn:1:execution-summary", () => anchorDocumentTop)
    const saveScrollSnapshot = vi.fn()
    const { result, getLatestThreadContentScrollTarget, unmount } = renderScrollController(
      threadColumn,
      { saveScrollSnapshot },
    )
    getLatestThreadContentScrollTarget.mockClear()

    const transaction = result.current.beginThreadProjectionLayoutTransaction({
      anchorRowID: "turn:1:execution-summary",
      sourceRowID: "process:row",
      turnID: "turn-1",
      affinity: "after",
    })
    expect(transaction?.anchor).toEqual({
      rowID: "turn:1:execution-summary",
      viewportOffset: 120,
      turnID: "turn-1",
      affinity: "after",
    })

    act(() => result.current.syncThreadScrollAfterContentChange())
    expect(getLatestThreadContentScrollTarget).not.toHaveBeenCalled()

    source.remove()
    sourceDocumentTop = 540
    anchorDocumentTop = 540
    act(() => {
      result.current.completeThreadProjectionLayoutTransaction(transaction!)
      animationFrames.flush()
    })
    expect(threadColumn.scrollTop).toBe(420)
    expect(animationFrames.size()).toBe(1)

    act(() => animationFrames.flush())
    expect(threadColumn.scrollTop).toBe(420)
    expect(animationFrames.size()).toBe(0)
    expect(saveScrollSnapshot).toHaveBeenLastCalledWith(
      "session:scroll-controller-test",
      expect.objectContaining({
        anchor: transaction!.anchor,
        pinnedToBottom: true,
        scrollTop: 420,
      }),
    )

    unmount()
    anchor.remove()
  })

  it("cancels pending corrections when user scroll intent arrives", () => {
    const animationFrames = installAnimationFrameQueue()
    const threadColumn = document.createElement("div")
    threadColumn.className = "thread-column"
    document.body.append(threadColumn)
    setScrollMetrics(threadColumn, { scrollTop: 500 })

    let anchorDocumentTop = 600
    appendVirtualRow(threadColumn, "turn:2:execution-summary", () => anchorDocumentTop)
    const { result, getLatestThreadContentScrollTarget, unmount } = renderScrollController(threadColumn)
    getLatestThreadContentScrollTarget.mockClear()

    const transaction = result.current.beginThreadProjectionLayoutTransaction({
      anchorRowID: "turn:2:execution-summary",
    })
    expect(transaction).not.toBeNull()
    anchorDocumentTop = 520
    result.current.completeThreadProjectionLayoutTransaction(transaction!)
    expect(animationFrames.size()).toBe(1)

    act(() => result.current.handleThreadScrollIntent({ currentTarget: threadColumn }))
    expect(animationFrames.size()).toBe(0)
    act(() => animationFrames.flush())
    expect(threadColumn.scrollTop).toBe(500)

    act(() => result.current.syncThreadScrollAfterContentChange())
    expect(getLatestThreadContentScrollTarget).toHaveBeenCalledTimes(1)
    unmount()
  })

  it("ignores identically named rows owned by a nested ThreadView", () => {
    const threadColumn = document.createElement("div")
    threadColumn.className = "thread-column"
    document.body.append(threadColumn)
    setScrollMetrics(threadColumn, { scrollTop: 500 })

    const nestedThreadColumn = document.createElement("div")
    nestedThreadColumn.className = "thread-column"
    threadColumn.append(nestedThreadColumn)
    setScrollMetrics(nestedThreadColumn, { scrollTop: 0 })
    appendVirtualRow(nestedThreadColumn, "shared-row", () => 10)
    appendVirtualRow(threadColumn, "shared-row", () => 640)

    const { result, unmount } = renderScrollController(threadColumn)
    const transaction = result.current.beginThreadProjectionLayoutTransaction({
      anchorRowID: "shared-row",
    })

    expect(transaction?.anchor.viewportOffset).toBe(140)
    result.current.cancelThreadProjectionLayoutTransaction(transaction!)
    unmount()
  })
})

describe("useThreadScrollController user scroll intent", () => {
  it("keeps an upward wheel gesture detached when a same-position programmatic scroll arrives first", () => {
    const threadColumn = document.createElement("div")
    threadColumn.className = "thread-column"
    document.body.append(threadColumn)
    setScrollMetrics(threadColumn, {
      clientHeight: 400,
      scrollHeight: 800,
      scrollTop: 400,
    })
    const saveScrollSnapshot = vi.fn()
    const { result, unmount } = renderScrollController(threadColumn, { saveScrollSnapshot })

    act(() => result.current.handleThreadWheelIntent({
      currentTarget: threadColumn,
      deltaY: -120,
    } as never))
    expect(result.current.isThreadScrollFollowing()).toBe(false)

    act(() => result.current.handleThreadScroll())
    expect(result.current.isThreadScrollFollowing()).toBe(false)

    threadColumn.scrollTop = 280
    act(() => result.current.handleThreadScroll())
    expect(result.current.isThreadScrollFollowing()).toBe(false)
    expect(saveScrollSnapshot).toHaveBeenLastCalledWith(
      "session:scroll-controller-test",
      expect.objectContaining({ pinnedToBottom: false, scrollTop: 280 }),
    )

    unmount()
  })

  it("clears an old wheel direction when a pointer scrollbar gesture starts", () => {
    const threadColumn = document.createElement("div")
    threadColumn.className = "thread-column"
    document.body.append(threadColumn)
    setScrollMetrics(threadColumn, {
      clientHeight: 400,
      scrollHeight: 800,
      scrollTop: 400,
    })
    const { result, unmount } = renderScrollController(threadColumn)

    act(() => result.current.handleThreadWheelIntent({
      currentTarget: threadColumn,
      deltaY: -120,
    } as never))
    threadColumn.scrollTop = 280
    act(() => result.current.handleThreadScroll())
    expect(result.current.isThreadScrollFollowing()).toBe(false)

    act(() => result.current.handleThreadScrollIntent({ currentTarget: threadColumn }))
    threadColumn.scrollTop = 400
    act(() => result.current.handleThreadScroll())
    expect(result.current.isThreadScrollFollowing()).toBe(true)

    unmount()
  })
})

describe("useThreadScrollController semantic snapshots", () => {
  it("restores legacy detached snapshots by scrollTop", () => {
    const threadColumn = document.createElement("div")
    threadColumn.className = "thread-column"
    document.body.append(threadColumn)
    setScrollMetrics(threadColumn)

    const snapshot: ThreadScrollSnapshot = {
      scrollTop: 300,
      pinnedToBottom: false,
      updatedAt: 1,
    }
    const { unmount } = renderScrollController(threadColumn, {
      readScrollSnapshot: () => snapshot,
    })

    expect(threadColumn.scrollTop).toBe(300)
    unmount()
  })

  it("uses a semantic row anchor to correct a restorable detached snapshot", () => {
    const threadColumn = document.createElement("div")
    threadColumn.className = "thread-column"
    document.body.append(threadColumn)
    setScrollMetrics(threadColumn)
    appendVirtualRow(threadColumn, "turn:restored:execution-summary", () => 380)

    const snapshot: ThreadScrollSnapshot = {
      scrollTop: 300,
      pinnedToBottom: false,
      updatedAt: 1,
      anchor: {
        rowID: "turn:restored:execution-summary",
        viewportOffset: 50,
        turnID: "turn-restored",
      },
    }
    const saveScrollSnapshot = vi.fn()
    const { unmount } = renderScrollController(threadColumn, {
      readScrollSnapshot: () => snapshot,
      saveScrollSnapshot,
    })

    expect(threadColumn.scrollTop).toBe(330)
    expect(saveScrollSnapshot).toHaveBeenLastCalledWith(
      "session:scroll-controller-test",
      expect.objectContaining({ anchor: snapshot.anchor, scrollTop: 330 }),
    )
    unmount()
  })

  it("restores a mounted semantic anchor when the legacy scrollTop no longer fits", () => {
    const threadColumn = document.createElement("div")
    threadColumn.className = "thread-column"
    document.body.append(threadColumn)
    setScrollMetrics(threadColumn, { clientHeight: 100, scrollHeight: 200 })
    appendVirtualRow(threadColumn, "turn:collapsed:execution-summary", () => 90)

    const snapshot: ThreadScrollSnapshot = {
      scrollTop: 800,
      pinnedToBottom: false,
      updatedAt: 1,
      anchor: {
        rowID: "turn:collapsed:execution-summary",
        viewportOffset: 40,
      },
    }
    const { unmount } = renderScrollController(threadColumn, {
      readScrollSnapshot: () => snapshot,
    })

    expect(threadColumn.scrollTop).toBe(50)
    unmount()
  })
})
