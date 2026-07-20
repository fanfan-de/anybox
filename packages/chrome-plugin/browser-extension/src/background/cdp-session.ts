type CdpDebuggee = {
  tabId: number
  sessionId?: string
}

type CdpEventListener = (
  source: CdpDebuggee,
  method: string,
  params: Record<string, unknown>,
) => void

type CdpDetachListener = (
  source: CdpDebuggee,
  reason?: string,
) => void

const attachedTabs = new Set<number>()
const eventListeners = new Set<CdpEventListener>()
const detachListeners = new Set<CdpDetachListener>()

export function commandAbortedError() {
  return Object.assign(
    new Error(
      "The browser command was cancelled because the Browser Host connection closed.",
    ),
    {
      code: "BACKEND_UNAVAILABLE",
      retryable: true,
    },
  )
}

export function throwIfCommandAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw commandAbortedError()
}

export function waitForCommandDelay(
  delayMs: number,
  signal?: AbortSignal,
) {
  if (!signal) {
    return new Promise<void>((resolve) => setTimeout(resolve, delayMs))
  }
  throwIfCommandAborted(signal)
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, delayMs)
    const onAbort = () => {
      clearTimeout(timer)
      signal.removeEventListener("abort", onAbort)
      reject(commandAbortedError())
    }
    signal.addEventListener("abort", onAbort, { once: true })
  })
}

export async function attachTabDebugger(tabId: number) {
  if (attachedTabs.has(tabId)) return
  try {
    await chrome.debugger.attach({ tabId }, "1.3")
    attachedTabs.add(tabId)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (
      message.includes("Another debugger")
      || message.includes("already attached")
    ) {
      throw new Error(`Cannot control tab ${tabId}: ${message}`)
    }
    throw error
  }
}

export function isTabDebuggerAttached(tabId: number) {
  return attachedTabs.has(tabId)
}

export async function detachTabDebugger(tabId: number) {
  if (!attachedTabs.has(tabId)) return false
  try {
    await chrome.debugger.detach({ tabId })
  } catch {
    // Chrome may already have detached during navigation or tab teardown.
  } finally {
    attachedTabs.delete(tabId)
  }
  return true
}

export async function detachAllDebuggers() {
  const tabIds = [...attachedTabs]
  await Promise.all(tabIds.map((tabId) => detachTabDebugger(tabId)))
  return tabIds
}

export async function sendCdp(
  tabId: number,
  method: string,
  commandParams: Record<string, unknown> = {},
  signal?: AbortSignal,
  sessionId?: string,
) {
  throwIfCommandAborted(signal)
  await attachTabDebugger(tabId)
  if (signal?.aborted) {
    await detachTabDebugger(tabId)
    throw commandAbortedError()
  }
  const target: CdpDebuggee = sessionId ? { tabId, sessionId } : { tabId }
  return await chrome.debugger.sendCommand(target, method, commandParams)
}

export function subscribeCdpEvents(listener: CdpEventListener) {
  eventListeners.add(listener)
  return () => eventListeners.delete(listener)
}

export function subscribeCdpDetach(listener: CdpDetachListener) {
  detachListeners.add(listener)
  return () => detachListeners.delete(listener)
}

chrome.debugger.onEvent?.addListener?.((
  source: CdpDebuggee,
  method: string,
  params: Record<string, unknown>,
) => {
  for (const listener of eventListeners) listener(source, method, params)
})

chrome.debugger.onDetach?.addListener?.((
  source: CdpDebuggee,
  reason?: string,
) => {
  if (typeof source.tabId === "number") attachedTabs.delete(source.tabId)
  for (const listener of detachListeners) listener(source, reason)
})
