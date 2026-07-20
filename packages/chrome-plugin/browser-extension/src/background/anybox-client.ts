import {
  ANYBOX_CHROME_NATIVE_HOST_NAME,
  BROWSER_EXTENSION_PROTOCOL_VERSION,
  BrowserExtensionClientMessage,
  BrowserExtensionServerMessage,
  type BrowserExtensionCommandMessage,
  type BrowserExtensionServerMessage as BrowserExtensionServerMessageValue,
} from "@anybox/chrome-shared/browser-extension"
import {
  BROWSER_CONTRACT_COMMAND_METHODS,
  BROWSER_CONTRACT_VERSION,
} from "@anybox/chrome-shared/browser-contract"
import { NativeHostChunkReassembler } from "./native-chunks"
import {
  detachAllDebuggers,
  finalizeDisconnectedTabLeases,
  finalizeExpiredTabLeases,
  handleBrowserCommand,
} from "./commands"
import {
  EXTENSION_INSTANCE_KEY,
  STATUS_STORAGE_KEY,
  type BridgeStatus,
} from "../shared/status"
import {
  configurePlaywrightDownloadDirectory,
} from "./playwright-executor"

const NATIVE_HOST_NAME = ANYBOX_CHROME_NATIVE_HOST_NAME
const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 60_000
const HELLO_ACK_TIMEOUT_MS = 10_000
const HEARTBEAT_INTERVAL_MS = 30_000
const HEARTBEAT_TIMEOUT_MS = 10_000
const HEALTH_ALARM_NAME = "anybox-browser-health"
const DISCONNECT_CLEANUP_ALARM_NAME = "anybox-browser-disconnect-cleanup"
const DISCONNECT_GRACE_MS = 2 * 60_000

type ActiveTransport = {
  kind: "native"
  send(message: unknown): boolean
  close(): void
}

let activeTransport: ActiveTransport | null = null
let acknowledged = false
let connecting = false
let reconnectTimer: number | undefined
let helloAckTimer: number | undefined
let healthTimer: number | undefined
let disconnectCleanupTimer: number | undefined
let reconnectAttempt = 0
let connectionAttempts = 0
let lastHostActivity = 0
let lastTransportError: string | undefined
const pendingCommands = new Map<string, AbortController>()
const nativeHostChunks = new NativeHostChunkReassembler()

function extensionVersion() {
  return chrome.runtime.getManifest().version as string
}

export async function getExtensionInstanceID() {
  const stored = await chrome.storage.local.get(EXTENSION_INSTANCE_KEY)
  const existing = stored[EXTENSION_INSTANCE_KEY]
  if (typeof existing === "string" && existing) return existing

  const created = crypto.randomUUID()
  await chrome.storage.local.set({ [EXTENSION_INSTANCE_KEY]: created })
  return created
}

async function setStatus(status: BridgeStatus) {
  await chrome.storage.local.set({ [STATUS_STORAGE_KEY]: status })
}

async function updateStatus(patch: Partial<BridgeStatus>) {
  const stored = await chrome.storage.local.get(STATUS_STORAGE_KEY)
  const current = stored[STATUS_STORAGE_KEY]
  const base = current && typeof current === "object"
    ? current as BridgeStatus
    : {
        state: "disconnected" as const,
        lastChecked: Date.now(),
      }
  await setStatus({
    ...base,
    ...patch,
    lastChecked: Date.now(),
  })
}

function reconnectDelay() {
  const exponential = Math.min(
    RECONNECT_MAX_MS,
    RECONNECT_BASE_MS * 2 ** reconnectAttempt,
  )
  const jitter = 0.75 + Math.random() * 0.5
  return Math.max(RECONNECT_BASE_MS, Math.trunc(exponential * jitter))
}

function clearTimers() {
  if (helloAckTimer !== undefined) self.clearTimeout(helloAckTimer)
  if (healthTimer !== undefined) self.clearTimeout(healthTimer)
  helloAckTimer = undefined
  healthTimer = undefined
}

function cancelDisconnectCleanup() {
  if (disconnectCleanupTimer !== undefined) {
    self.clearTimeout(disconnectCleanupTimer)
    disconnectCleanupTimer = undefined
  }
  void chrome.alarms.clear(DISCONNECT_CLEANUP_ALARM_NAME)
}

async function recordCleanup(result: {
  closedTabIds: number[]
  releasedTabIds: number[]
  deliverableTabIds: number[]
  handoffTabIds: number[]
  detachedTabIds: number[]
}) {
  await updateStatus({
    cleanup: {
      closed: result.closedTabIds.length,
      released: result.releasedTabIds.length,
      deliverable: result.deliverableTabIds.length,
      handoff: result.handoffTabIds.length,
      detached: result.detachedTabIds.length,
      completedAt: Date.now(),
    },
  })
}

async function runDisconnectCleanup() {
  disconnectCleanupTimer = undefined
  if (activeTransport && acknowledged) return
  await recordCleanup(await finalizeDisconnectedTabLeases())
}

function scheduleDisconnectCleanup() {
  if (disconnectCleanupTimer === undefined) {
    disconnectCleanupTimer = self.setTimeout(
      () => void runDisconnectCleanup().catch(() => undefined),
      DISCONNECT_GRACE_MS,
    )
  }
  try {
    chrome.alarms.create(DISCONNECT_CLEANUP_ALARM_NAME, {
      when: Date.now() + DISCONNECT_GRACE_MS,
    })
  } catch {
    // The short timer covers Chrome versions without one-shot alarms.
  }
}

function scheduleReconnect() {
  if (reconnectTimer !== undefined) return
  const delay = reconnectDelay()
  reconnectAttempt += 1
  reconnectTimer = self.setTimeout(() => {
    reconnectTimer = undefined
    connectAnybox()
  }, delay)
}

function sendClientMessage(message: unknown) {
  if (!activeTransport) return false
  return activeTransport.send(BrowserExtensionClientMessage.parse(message))
}

async function sendHello() {
  sendClientMessage({
    type: "hello",
    protocolVersion: BROWSER_EXTENSION_PROTOCOL_VERSION,
    extensionID: chrome.runtime.id,
    extensionInstanceID: await getExtensionInstanceID(),
    version: extensionVersion(),
    capabilities: {
      contractVersion: BROWSER_CONTRACT_VERSION,
      commands: BROWSER_CONTRACT_COMMAND_METHODS,
    },
    lastTransportError,
  })
}

async function handleCommand(message: BrowserExtensionCommandMessage) {
  const controller = new AbortController()
  pendingCommands.set(message.commandID, controller)
  try {
    if (!acknowledged) {
      throw Object.assign(
        new Error("The Anybox browser host has not acknowledged this extension connection."),
        { code: "BACKEND_UNAVAILABLE", retryable: true },
      )
    }
    const data = await handleBrowserCommand(message.method, message.params, {
      context: message.context,
      signal: controller.signal,
    })
    sendClientMessage({
      type: "result",
      commandID: message.commandID,
      ok: true,
      data,
    })
  } catch (error) {
    const code = error && typeof error === "object"
      && typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : undefined
    const retryable = error && typeof error === "object"
      && typeof (error as { retryable?: unknown }).retryable === "boolean"
      ? (error as { retryable: boolean }).retryable
      : undefined
    const details = error && typeof error === "object"
      && (error as { details?: unknown }).details
      && typeof (error as { details?: unknown }).details === "object"
      && !Array.isArray((error as { details?: unknown }).details)
      ? (error as { details: Record<string, unknown> }).details
      : undefined
    sendClientMessage({
      type: "result",
      commandID: message.commandID,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      ...(code ? { code } : {}),
      ...(retryable !== undefined ? { retryable } : {}),
      ...(details ? { details } : {}),
    })
  } finally {
    pendingCommands.delete(message.commandID)
  }
}

function parseServerMessage(raw: unknown) {
  const json = typeof raw === "string" ? JSON.parse(raw) : raw
  return BrowserExtensionServerMessage.parse(json) as BrowserExtensionServerMessageValue
}

function markConnectionAcknowledged(message: Extract<
  BrowserExtensionServerMessageValue,
  { type: "helloAck" }
>) {
  void getExtensionInstanceID().then((instanceID) => {
    if (message.extensionInstanceID !== instanceID) {
      disconnectActiveTransport("Host acknowledgement targeted another extension instance.")
      return
    }
    acknowledged = true
    configurePlaywrightDownloadDirectory(message.downloadDirectory)
    cancelDisconnectCleanup()
    reconnectAttempt = 0
    lastHostActivity = Date.now()
    if (helloAckTimer !== undefined) self.clearTimeout(helloAckTimer)
    helloAckTimer = undefined
    void setStatus({
      state: "connected",
      lastChecked: Date.now(),
      transport: "native",
      hostName: NATIVE_HOST_NAME,
      protocolVersion: BROWSER_EXTENSION_PROTOCOL_VERSION,
      contractVersion: message.contractVersion,
      browserID: message.browserID,
      reconnectCount: Math.max(0, connectionAttempts - 1),
    })
    scheduleHealthCheck()
  })
}

function handleServerMessage(raw: unknown) {
  const parsed = parseServerMessage(raw)
  lastHostActivity = Date.now()
  switch (parsed.type) {
    case "helloAck":
      markConnectionAcknowledged(parsed)
      return
    case "command":
      void handleCommand(parsed)
      return
    case "ping":
      sendClientMessage({
        type: "pong",
        nonce: parsed.nonce,
      })
      return
  }
}

function transportErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "string" && error.trim()) return error.trim()
  const runtimeError = chrome.runtime.lastError?.message
  return runtimeError || String(error || "Unknown browser bridge transport error.")
}

function scheduleHealthCheck() {
  if (healthTimer !== undefined) self.clearTimeout(healthTimer)
  healthTimer = self.setTimeout(() => {
    healthTimer = undefined
    const staleFor = Date.now() - lastHostActivity
    if (
      !activeTransport
      || !acknowledged
      || staleFor > HEARTBEAT_INTERVAL_MS + HEARTBEAT_TIMEOUT_MS
    ) {
      disconnectActiveTransport(
        `Browser host heartbeat was stale for ${staleFor}ms.`,
      )
      return
    }
    scheduleHealthCheck()
  }, HEARTBEAT_INTERVAL_MS + HEARTBEAT_TIMEOUT_MS)
}

function disconnectActiveTransport(reason?: string) {
  const transport = activeTransport
  activeTransport = null
  acknowledged = false
  connecting = false
  clearTimers()
  if (reason) lastTransportError = reason
  for (const controller of pendingCommands.values()) {
    controller.abort(reason)
  }
  pendingCommands.clear()
  nativeHostChunks.reset()
  transport?.close()
  void detachAllDebuggers()
  scheduleDisconnectCleanup()
  void setStatus({
    state: "disconnected",
    lastChecked: Date.now(),
    transport: "native",
    hostName: NATIVE_HOST_NAME,
    error: lastTransportError,
    protocolVersion: BROWSER_EXTENSION_PROTOCOL_VERSION,
    reconnectCount: Math.max(0, connectionAttempts - 1),
  })
  scheduleReconnect()
}

function connectNativeTransport() {
  connectionAttempts += 1
  connecting = true
  acknowledged = false
  void setStatus({
    state: "connecting",
    lastChecked: Date.now(),
    transport: "native",
    hostName: NATIVE_HOST_NAME,
    protocolVersion: BROWSER_EXTENSION_PROTOCOL_VERSION,
    reconnectCount: Math.max(0, connectionAttempts - 1),
  })

  let port: any
  try {
    port = chrome.runtime.connectNative(NATIVE_HOST_NAME)
  } catch (error) {
    connecting = false
    lastTransportError = transportErrorMessage(error)
    void setStatus({
      state: "disconnected",
      lastChecked: Date.now(),
      transport: "native",
      hostName: NATIVE_HOST_NAME,
      error: lastTransportError,
      protocolVersion: BROWSER_EXTENSION_PROTOCOL_VERSION,
      reconnectCount: Math.max(0, connectionAttempts - 1),
    })
    scheduleReconnect()
    scheduleDisconnectCleanup()
    return
  }

  const transport: ActiveTransport = {
    kind: "native",
    send(message) {
      try {
        port.postMessage(message)
        return true
      } catch (error) {
        lastTransportError = transportErrorMessage(error)
        return false
      }
    },
    close() {
      try {
        port.disconnect()
      } catch {
        // The port may already be disconnected.
      }
    },
  }

  activeTransport = transport
  connecting = false
  nativeHostChunks.reset()
  lastHostActivity = Date.now()
  void sendHello()
  helloAckTimer = self.setTimeout(() => {
    helloAckTimer = undefined
    if (!acknowledged) {
      disconnectActiveTransport("Browser host hello acknowledgement timed out.")
    }
  }, HELLO_ACK_TIMEOUT_MS)

  port.onMessage.addListener((message: unknown) => {
    try {
      lastHostActivity = Date.now()
      const unwrapped = message
        && typeof message === "object"
        && (message as { type?: unknown }).type === "native.chunk"
        ? nativeHostChunks.push(message)
        : message
      if (unwrapped !== undefined) handleServerMessage(unwrapped)
    } catch (error) {
      sendClientMessage({
        type: "event",
        event: "client_error",
        data: { message: error instanceof Error ? error.message : String(error) },
      })
    }
  })

  port.onDisconnect.addListener(() => {
    if (activeTransport !== transport) return
    const message = chrome.runtime.lastError?.message
    if (message) lastTransportError = message
    disconnectActiveTransport(message)
  })
}

function installHealthAlarm() {
  try {
    chrome.alarms.create(HEALTH_ALARM_NAME, {
      periodInMinutes: HEARTBEAT_INTERVAL_MS / 60_000,
    })
  } catch {
    // Short timer remains the primary path on Chrome versions that reject it.
  }
}

chrome.alarms.onAlarm.addListener((alarm: any) => {
  if (alarm?.name === DISCONNECT_CLEANUP_ALARM_NAME) {
    void runDisconnectCleanup().catch(() => undefined)
    return
  }
  if (alarm?.name !== HEALTH_ALARM_NAME) return
  void finalizeExpiredTabLeases()
    .then(recordCleanup)
    .catch(() => undefined)
  if (!activeTransport || !acknowledged) {
    connectAnybox()
    return
  }
  const staleFor = Date.now() - lastHostActivity
  if (staleFor > HEARTBEAT_INTERVAL_MS + HEARTBEAT_TIMEOUT_MS) {
    disconnectActiveTransport(`Browser host heartbeat was stale for ${staleFor}ms.`)
  }
})

installHealthAlarm()

export function connectAnybox() {
  if (activeTransport || connecting) return
  connectNativeTransport()
}

export function shutdownAnyboxClient() {
  const transport = activeTransport
  activeTransport = null
  acknowledged = false
  connecting = false
  clearTimers()
  if (reconnectTimer !== undefined) self.clearTimeout(reconnectTimer)
  if (disconnectCleanupTimer !== undefined) {
    self.clearTimeout(disconnectCleanupTimer)
  }
  reconnectTimer = undefined
  disconnectCleanupTimer = undefined
  for (const controller of pendingCommands.values()) {
    controller.abort("Anybox browser client shut down.")
  }
  pendingCommands.clear()
  nativeHostChunks.reset()
  transport?.close()
}

export function getBridgeStatusStorageKey() {
  return STATUS_STORAGE_KEY
}
