import { act, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SIDEBAR_RESIZE_END_EVENT } from "../sidebar-resize-events"
import type { ThreadDisplayRow } from "./thread-display-rows"
import { ThreadRows } from "./ThreadRows"
import type { ThreadRowVirtualizer } from "./use-thread-virtual-list"

function createDisplayRows(): ThreadDisplayRow[] {
  return [
    { rowID: "row-0" },
    { rowID: "row-1" },
  ] as ThreadDisplayRow[]
}

function createVirtualizer(events: string[]) {
  return {
    containerRef: vi.fn(),
    measureElement: vi.fn(),
    resizeItem: vi.fn((index: number) => {
      events.push(`write:${index}`)
    }),
  } as unknown as ThreadRowVirtualizer
}

describe("ThreadRows measurement", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", undefined)
    vi.stubGlobal("ResizeObserver", undefined)
  })

  afterEach(() => {
    document.body.classList.remove("is-resizing-sidebar")
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("reads every rendered row before writing measurements to the virtualizer", () => {
    const events: string[] = []
    const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("thread-virtual-row")) {
        events.push(`read:${this.dataset.index}`)
      }
      return {
        bottom: 48,
        height: 48,
        left: 0,
        right: 320,
        top: 0,
        width: 320,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }
    })
    const virtualizer = createVirtualizer(events)
    const displayRows = createDisplayRows()

    render(
      <ThreadRows
        displayRows={displayRows}
        renderRow={(row) => <div>{row.rowID}</div>}
        virtualItems={[
          { end: 48, index: 0, key: "row-0", lane: 0, size: 48, start: 0 },
          { end: 103, index: 1, key: "row-1", lane: 0, size: 48, start: 55 },
        ]}
        virtualizer={virtualizer}
        virtualTotalSize={103}
      />,
    )

    expect(events.slice(0, 4)).toEqual(["read:0", "read:1", "write:0", "write:1"])
    expect(rectSpy).toHaveBeenCalled()
  })

  it("defers row measurement until sidebar resizing ends", () => {
    document.body.classList.add("is-resizing-sidebar")
    const events: string[] = []
    const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("thread-virtual-row")) {
        events.push(`read:${this.dataset.index}`)
      }
      return {
        bottom: 48,
        height: 48,
        left: 0,
        right: 320,
        top: 0,
        width: 320,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }
    })
    const virtualizer = createVirtualizer(events)
    const displayRows = createDisplayRows()

    render(
      <ThreadRows
        displayRows={displayRows}
        renderRow={(row) => <div>{row.rowID}</div>}
        virtualItems={[
          { end: 48, index: 0, key: "row-0", lane: 0, size: 48, start: 0 },
          { end: 103, index: 1, key: "row-1", lane: 0, size: 48, start: 55 },
        ]}
        virtualizer={virtualizer}
        virtualTotalSize={103}
      />,
    )

    expect(events).toEqual([])
    expect(rectSpy).not.toHaveBeenCalled()

    document.body.classList.remove("is-resizing-sidebar")
    act(() => {
      window.dispatchEvent(new Event(SIDEBAR_RESIZE_END_EVENT))
    })

    expect(events).toEqual(["read:0", "read:1", "write:0", "write:1"])
  })
})
