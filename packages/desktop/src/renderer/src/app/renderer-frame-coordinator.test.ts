import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  beginRendererInteractiveLayout,
  endRendererInteractiveLayout,
  flushRendererFrameNow,
  queueRendererLayoutWrite,
  queueRendererStreamFlush,
  resetRendererFrameCoordinatorForTest,
} from "./renderer-frame-coordinator"

function installManualAnimationFrame() {
  const originalRequestAnimationFrame = window.requestAnimationFrame
  const originalCancelAnimationFrame = window.cancelAnimationFrame
  let nextFrameID = 0
  const pendingFrames = new Map<number, FrameRequestCallback>()

  window.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
    nextFrameID += 1
    pendingFrames.set(nextFrameID, callback)
    return nextFrameID
  })
  window.cancelAnimationFrame = vi.fn((frameID: number) => {
    pendingFrames.delete(frameID)
  })

  return {
    flush(timestamp = 0) {
      const callbacks = Array.from(pendingFrames.values())
      pendingFrames.clear()
      for (const callback of callbacks) {
        callback(timestamp)
      }
    },
    get pendingCount() {
      return pendingFrames.size
    },
    restore() {
      pendingFrames.clear()
      window.requestAnimationFrame = originalRequestAnimationFrame
      window.cancelAnimationFrame = originalCancelAnimationFrame
    },
  }
}

describe("renderer frame coordinator", () => {
  let animationFrame: ReturnType<typeof installManualAnimationFrame>

  beforeEach(() => {
    resetRendererFrameCoordinatorForTest()
    animationFrame = installManualAnimationFrame()
  })

  afterEach(() => {
    resetRendererFrameCoordinatorForTest()
    animationFrame.restore()
    vi.restoreAllMocks()
  })

  it("keeps only the latest layout write for the same key", () => {
    const calls: string[] = []

    queueRendererLayoutWrite("sidebar-resize:right", () => calls.push("first"))
    queueRendererLayoutWrite("sidebar-resize:right", () => calls.push("second"))

    expect(animationFrame.pendingCount).toBe(1)

    animationFrame.flush(10)

    expect(calls).toEqual(["second"])
  })

  it("runs layout writes before stream flushes in a frame", () => {
    const calls: string[] = []

    queueRendererStreamFlush(() => calls.push("stream"))
    queueRendererLayoutWrite("sidebar-resize:right", () => calls.push("layout"))

    animationFrame.flush(10)

    expect(calls).toEqual(["layout", "stream"])
  })

  it("throttles stream flushes during interactive layout without starving them", () => {
    const calls: string[] = []

    beginRendererInteractiveLayout("sidebar-resize")
    queueRendererStreamFlush(() => calls.push("first"), { interactiveIntervalMs: 32 })
    animationFrame.flush(0)

    expect(calls).toEqual(["first"])

    queueRendererStreamFlush(() => calls.push("second"), { interactiveIntervalMs: 32 })
    animationFrame.flush(10)
    animationFrame.flush(20)

    expect(calls).toEqual(["first"])
    expect(animationFrame.pendingCount).toBe(1)

    animationFrame.flush(32)

    expect(calls).toEqual(["first", "second"])
    endRendererInteractiveLayout("sidebar-resize")
  })

  it("flushes pending layout and stream work synchronously", () => {
    const calls: string[] = []

    queueRendererLayoutWrite("sidebar-resize:left", () => calls.push("layout"))
    queueRendererStreamFlush(() => calls.push("stream"))

    flushRendererFrameNow("test")

    expect(calls).toEqual(["layout", "stream"])
    expect(animationFrame.pendingCount).toBe(0)
  })
})
