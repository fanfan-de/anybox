type FrameHandle =
  | {
      id: number
      kind: "frame"
    }
  | {
      id: number
      kind: "timer"
    }

type LayoutWriteTask = () => void
type StreamFlushTask = () => void

export type RendererFrameTaskCancel = () => void

export interface RendererStreamFlushOptions {
  interactiveIntervalMs?: number
}

const DEFAULT_INTERACTIVE_STREAM_FLUSH_INTERVAL_MS = 32

let frameHandle: FrameHandle | null = null
let interactiveLayoutDepth = 0
let interactiveLayoutReasons = new Map<string, number>()
let isFlushingFrame = false
let lastStreamFlushAt = Number.NEGATIVE_INFINITY
let layoutWriteTasks = new Map<string, LayoutWriteTask>()
let streamFlushTask: StreamFlushTask | null = null
let streamFlushOptions: RendererStreamFlushOptions = {}

function readNow() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now()
}

function hasPendingFrameWork() {
  return layoutWriteTasks.size > 0 || streamFlushTask !== null
}

function clearScheduledFrame() {
  const handle = frameHandle
  if (!handle) return

  if (typeof window !== "undefined") {
    if (handle.kind === "frame" && typeof window.cancelAnimationFrame === "function") {
      window.cancelAnimationFrame(handle.id)
    } else {
      window.clearTimeout(handle.id)
    }
  }
  frameHandle = null
}

function shouldFlushStream(timestamp: number, forceStream: boolean) {
  if (!streamFlushTask) return false
  if (forceStream || interactiveLayoutDepth === 0) return true

  const intervalMs = streamFlushOptions.interactiveIntervalMs ?? DEFAULT_INTERACTIVE_STREAM_FLUSH_INTERVAL_MS
  return timestamp - lastStreamFlushAt >= intervalMs
}

function runFrame(timestamp: number, options: { forceStream?: boolean; reason: string }) {
  if (isFlushingFrame) return

  isFlushingFrame = true

  try {
    const pendingLayoutWrites = layoutWriteTasks
    layoutWriteTasks = new Map()

    for (const task of pendingLayoutWrites.values()) {
      task()
    }

    if (shouldFlushStream(timestamp, options.forceStream === true)) {
      const task = streamFlushTask
      streamFlushTask = null
      streamFlushOptions = {}
      lastStreamFlushAt = timestamp
      task?.()
    }
  } finally {
    isFlushingFrame = false

    if (hasPendingFrameWork()) {
      scheduleFrame()
    }
  }
}

function scheduleFrame() {
  if (frameHandle !== null || isFlushingFrame || !hasPendingFrameWork()) return

  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    frameHandle = {
      id: window.requestAnimationFrame((timestamp) => {
        frameHandle = null
        runFrame(timestamp, { reason: "frame" })
      }),
      kind: "frame",
    }
    return
  }

  if (typeof window !== "undefined") {
    frameHandle = {
      id: window.setTimeout(() => {
        frameHandle = null
        runFrame(readNow(), { reason: "timer" })
      }, 0),
      kind: "timer",
    }
  }
}

export function queueRendererLayoutWrite(key: string, task: LayoutWriteTask): RendererFrameTaskCancel {
  layoutWriteTasks.set(key, task)
  scheduleFrame()

  return () => {
    if (layoutWriteTasks.get(key) !== task) return
    layoutWriteTasks.delete(key)
    if (!hasPendingFrameWork()) {
      clearScheduledFrame()
    }
  }
}

export function queueRendererStreamFlush(
  task: StreamFlushTask,
  options: RendererStreamFlushOptions = {},
): RendererFrameTaskCancel {
  streamFlushTask = task
  streamFlushOptions = options
  scheduleFrame()

  return () => {
    if (streamFlushTask !== task) return
    streamFlushTask = null
    streamFlushOptions = {}
    if (!hasPendingFrameWork()) {
      clearScheduledFrame()
    }
  }
}

export function beginRendererInteractiveLayout(reason = "interactive") {
  interactiveLayoutDepth += 1
  interactiveLayoutReasons.set(reason, (interactiveLayoutReasons.get(reason) ?? 0) + 1)
}

export function endRendererInteractiveLayout(reason = "interactive") {
  interactiveLayoutDepth = Math.max(0, interactiveLayoutDepth - 1)
  const reasonCount = interactiveLayoutReasons.get(reason) ?? 0
  if (reasonCount <= 1) {
    interactiveLayoutReasons.delete(reason)
  } else {
    interactiveLayoutReasons.set(reason, reasonCount - 1)
  }
  if (hasPendingFrameWork()) {
    scheduleFrame()
  }
}

export function flushRendererFrameNow(reason = "manual") {
  if (!hasPendingFrameWork()) return

  clearScheduledFrame()
  runFrame(readNow(), {
    forceStream: true,
    reason,
  })
}

export function resetRendererFrameCoordinatorForTest() {
  clearScheduledFrame()
  interactiveLayoutDepth = 0
  interactiveLayoutReasons = new Map()
  isFlushingFrame = false
  lastStreamFlushAt = Number.NEGATIVE_INFINITY
  layoutWriteTasks = new Map()
  streamFlushTask = null
  streamFlushOptions = {}
}
