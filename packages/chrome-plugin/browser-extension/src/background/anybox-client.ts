import {
  BrowserExtensionClientMessage,
  BrowserExtensionServerMessage,
  type BrowserExtensionCommandMessage,
  type BrowserExtensionServerMessage as BrowserExtensionServerMessageValue,
} from "@anybox/shared/browser-extension"
import { handleBrowserCommand } from "./commands"
import {
  EXTENSION_INSTANCE_KEY,
  STATUS_STORAGE_KEY,
  type BridgeStatus,
} from "../shared/status"

const ANYBOX_WS_URL = "ws://127.0.0.1:4096/api/browser-extension/ws"
const NATIVE_HOST_NAME = "com.anybox.browser"
const FORCE_WEBSOCKET_STORAGE_KEY = "ANYBOX_FORCE_WEBSOCKET_BRIDGE"
const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 15_000

type TransportKind = "native" | "websocket"

type ActiveTransport = {
  kind: TransportKind
  send(message: unknown): boolean
  close(): void
}

let activeTransport: ActiveTransport | null = null
let connecting = false
let reconnectTimer: number | undefined
let reconnectAttempt = 0
let lastTransportError: string | undefined

function extensionVersion() {
  return chrome.runtime.getManifest().version as string
}

async function extensionInstanceID() {
  const stored = await chrome.storage.local.get(EXTENSION_INSTANCE_KEY)
  const existing = stored[EXTENSION_INSTANCE_KEY]
  if (typeof existing === "string" && existing) return existing

  const created = crypto.randomUUID()
  await chrome.storage.local.set({ [EXTENSION_INSTANCE_KEY]: created })
  return created
}

async function shouldForceWebSocket() {
  const stored = await chrome.storage.local.get(FORCE_WEBSOCKET_STORAGE_KEY)
  return stored[FORCE_WEBSOCKET_STORAGE_KEY] === true
}

async function setStatus(status: BridgeStatus) {
  await chrome.storage.local.set({ [STATUS_STORAGE_KEY]: status })
}

function scheduleReconnect() {
  if (reconnectTimer !== undefined) return
  const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** reconnectAttempt)
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
    extensionID: chrome.runtime.id,
    extensionInstanceID: await extensionInstanceID(),
    version: extensionVersion(),
    transport: activeTransport?.kind,
    hostName: activeTransport?.kind === "native" ? NATIVE_HOST_NAME : undefined,
    lastTransportError,
  })
}

async function handleCommand(message: BrowserExtensionCommandMessage) {
  try {
    const data = await handleBrowserCommand(message.method, message.params)
    sendClientMessage({
      type: "result",
      commandID: message.commandID,
      ok: true,
      data,
    })
  } catch (error) {
    sendClientMessage({
      type: "result",
      commandID: message.commandID,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function parseServerMessage(raw: unknown) {
  const json = typeof raw === "string" ? JSON.parse(raw) : raw
  return BrowserExtensionServerMessage.parse(json) as BrowserExtensionServerMessageValue
}

function handleServerMessage(raw: unknown) {
  const parsed = parseServerMessage(raw)
  switch (parsed.type) {
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

function clearActiveTransport(transport: ActiveTransport) {
  if (activeTransport === transport) activeTransport = null
}

function connectNativeTransport() {
  connecting = true
  void setStatus({ state: "connecting", lastChecked: Date.now(), transport: "native", hostName: NATIVE_HOST_NAME })

  let port: any
  try {
    port = chrome.runtime.connectNative(NATIVE_HOST_NAME)
  } catch (error) {
    connecting = false
    lastTransportError = transportErrorMessage(error)
    connectWebSocketTransport()
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
  reconnectAttempt = 0
  connecting = false
  void setStatus({ state: "connected", lastChecked: Date.now(), transport: "native", hostName: NATIVE_HOST_NAME })
  void sendHello()

  port.onMessage.addListener((message: unknown) => {
    try {
      handleServerMessage(message)
    } catch (error) {
      sendClientMessage({
        type: "event",
        event: "client_error",
        data: { message: error instanceof Error ? error.message : String(error) },
      })
    }
  })

  port.onDisconnect.addListener(() => {
    clearActiveTransport(transport)
    const message = chrome.runtime.lastError?.message
    if (message) lastTransportError = message
    void setStatus({
      state: "disconnected",
      lastChecked: Date.now(),
      transport: "native",
      hostName: NATIVE_HOST_NAME,
      error: message,
    })

    if (message) {
      connectWebSocketTransport()
      return
    }
    scheduleReconnect()
  })
}

function connectWebSocketTransport() {
  connecting = true
  void setStatus({ state: "connecting", lastChecked: Date.now(), transport: "websocket", error: lastTransportError })

  let socket: WebSocket
  try {
    socket = new WebSocket(ANYBOX_WS_URL)
  } catch (error) {
    connecting = false
    lastTransportError = transportErrorMessage(error)
    void setStatus({
      state: "disconnected",
      lastChecked: Date.now(),
      transport: "websocket",
      error: lastTransportError,
    })
    scheduleReconnect()
    return
  }

  const transport: ActiveTransport = {
    kind: "websocket",
    send(message) {
      if (socket.readyState !== WebSocket.OPEN) return false
      socket.send(JSON.stringify(message))
      return true
    },
    close() {
      socket.close()
    },
  }

  socket.addEventListener("open", () => {
    activeTransport = transport
    reconnectAttempt = 0
    connecting = false
    void setStatus({ state: "connected", lastChecked: Date.now(), transport: "websocket", error: lastTransportError })
    void sendHello()
  })

  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return
    try {
      handleServerMessage(event.data)
    } catch (error) {
      sendClientMessage({
        type: "event",
        event: "client_error",
        data: { message: error instanceof Error ? error.message : String(error) },
      })
    }
  })

  socket.addEventListener("close", () => {
    clearActiveTransport(transport)
    connecting = false
    void setStatus({ state: "disconnected", lastChecked: Date.now(), transport: "websocket", error: lastTransportError })
    scheduleReconnect()
  })

  socket.addEventListener("error", () => {
    lastTransportError = "WebSocket connection failed."
    void setStatus({ state: "disconnected", lastChecked: Date.now(), transport: "websocket", error: lastTransportError })
  })
}

export function connectAnybox() {
  if (activeTransport || connecting) return
  void (async () => {
    if (await shouldForceWebSocket()) {
      connectWebSocketTransport()
      return
    }
    connectNativeTransport()
  })()
}

export function getBridgeStatusStorageKey() {
  return STATUS_STORAGE_KEY
}
