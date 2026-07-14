import { afterEach, describe, expect, it, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"
import type { Virtualizer } from "@tanstack/react-virtual"
import { SIDEBAR_RESIZE_END_EVENT, SIDEBAR_RESIZE_START_EVENT } from "../sidebar-resize-events"
import {
  measureThreadVirtualElement,
  observeThreadVirtualElementOffset,
  readThreadVirtualResizeObserverRect,
  useThreadVirtualList,
} from "./use-thread-virtual-list"

afterEach(() => {
  document.body.classList.remove("is-resizing-sidebar")
  vi.restoreAllMocks()
})

describe("readThreadVirtualResizeObserverRect", () => {
  it("uses ResizeObserver border-box dimensions without reading layout", () => {
    const element = document.createElement("div")
    const layoutSpy = vi.spyOn(element, "getBoundingClientRect")
    const entry = {
      borderBoxSize: [{ blockSize: 640, inlineSize: 420 }],
      contentBoxSize: [],
      contentRect: {
        bottom: 620,
        height: 620,
        left: 0,
        right: 400,
        top: 0,
        width: 400,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      },
      devicePixelContentBoxSize: [],
      target: element,
    } as unknown as ResizeObserverEntry

    expect(readThreadVirtualResizeObserverRect(element, entry)).toEqual({
      height: 640,
      width: 420,
    })
    expect(layoutSpy).not.toHaveBeenCalled()
  })

  it("uses passive row ResizeObserver measurements while sidebar resizing", () => {
    document.body.classList.add("is-resizing-sidebar")
    const element = document.createElement("div")
    const layoutSpy = vi.spyOn(element, "getBoundingClientRect")
    const entry = {
      borderBoxSize: [{ blockSize: 72, inlineSize: 420 }],
      contentBoxSize: [],
      contentRect: {
        bottom: 72,
        height: 72,
        left: 0,
        right: 420,
        top: 0,
        width: 420,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      },
      devicePixelContentBoxSize: [],
      target: element,
    } as unknown as ResizeObserverEntry
    const virtualizer = {
      options: { horizontal: false },
    } as unknown as Virtualizer<HTMLDivElement, HTMLDivElement>

    expect(measureThreadVirtualElement(element, entry, virtualizer)).toBe(72)
    expect(layoutSpy).not.toHaveBeenCalled()
  })

  it("suppresses scroll adjustment during interactive resize without changing overscan", () => {
    const threadColumn = document.createElement("div")
    document.body.append(threadColumn)
    const threadColumnRef = { current: threadColumn }
    const { result, unmount } = renderHook(
      () => useThreadVirtualList({
        displayRows: [],
        threadColumnRef,
        virtualListKey: "resize-test",
      }),
    )

    expect(result.current.rowVirtualizer.options.overscan).toBe(8)
    expect(result.current.rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange).toBeUndefined()

    document.body.classList.add("is-resizing-sidebar")
    act(() => {
      window.dispatchEvent(new Event(SIDEBAR_RESIZE_START_EVENT))
    })

    expect(result.current.rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange).toBeTypeOf("function")
    expect(result.current.rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange!(
      {} as never,
      12,
      result.current.rowVirtualizer,
    )).toBe(false)

    document.body.classList.remove("is-resizing-sidebar")
    act(() => {
      window.dispatchEvent(new Event(SIDEBAR_RESIZE_END_EVENT))
    })

    expect(result.current.rowVirtualizer.options.overscan).toBe(8)
    expect(result.current.rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange).toBeUndefined()

    unmount()
    threadColumn.remove()
  })
})

describe("observeThreadVirtualElementOffset", () => {
  it("cancels the pending scroll-end callback when the virtualizer unmounts", () => {
    vi.useFakeTimers()
    const threadColumn = document.createElement("div")
    document.body.append(threadColumn)
    const callback = vi.fn()
    const virtualizer = {
      options: {
        horizontal: false,
        isRtl: false,
        isScrollingResetDelay: 150,
      },
      scrollElement: threadColumn,
      targetWindow: window,
    } as unknown as Virtualizer<HTMLDivElement, HTMLDivElement>

    try {
      const cleanup = observeThreadVirtualElementOffset(virtualizer, callback)
      threadColumn.scrollTop = 120
      threadColumn.dispatchEvent(new Event("scroll"))

      expect(callback).toHaveBeenCalledWith(120, true)
      cleanup?.()
      vi.advanceTimersByTime(150)
      expect(callback).toHaveBeenCalledTimes(1)
    } finally {
      threadColumn.remove()
      vi.useRealTimers()
    }
  })
})
