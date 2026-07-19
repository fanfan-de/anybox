import {
  ANYBOX_CHROME_NATIVE_HOST_NAME,
  BROWSER_EXTENSION_PROTOCOL_VERSION,
  BrowserExtensionClientMessage,
  BrowserExtensionServerMessage,
  type BrowserExtensionCommandMessage,
  type BrowserExtensionServerMessage as BrowserExtensionServerMessageValue,
} from "@anybox/shared/browser-extension"
import {
  BROWSER_CONTRACT_COMMAND_METHODS,
  BROWSER_CONTRACT_VERSION,
} from "@anybox/shared/browser-contract"
import {
  supportsBrowserCommandContractVersion,
} from "./browser-contract-compat"
import { handleBrowserCommand } from "./commands"
import {
  EXTENSION_INSTANCE_KEY,
  STATUS_STORAGE_KEY,
  type BridgeStatus,
} from "../shared/status"

const NATIVE_HOST_NAME = ANYBOX_CHROME_NATIVE_HOST_NAME
const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 15_000

type ActiveTransport = {
  kind: "native"
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
    protocolVersion: BROWSER_EXTENSION_PROTOCOL_VERSION,
    extensionID: chrome.runtime.id,
    extensionInstanceID: await extensionInstanceID(),
    version: extensionVersion(),
    capabilities: {
      contractVersion: BROWSER_CONTRACT_VERSION,
      commands: BROWSER_CONTRACT_COMMAND_METHODS,
    },
    lastTransportError,
  })
}

async function handleCommand(message: BrowserExtensionCommandMessage) {
  try {
    if (!supportsBrowserCommandContractVersion(message.contractVersion)) {
      throw Object.assign(
        new Error("The browser command contract version is not supported."),
        {
          code: "CONTRACT_VERSION_UNSUPPORTED",
          retryable: false,
        },
      )
    }
    const data = await handleBrowserCommand(message.method, message.params)
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
    sendClientMessage({
      type: "result",
      commandID: message.commandID,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      ...(code ? { code } : {}),
      ...(retryable !== undefined ? { retryable } : {}),
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
    void setStatus({
      state: "disconnected",
      lastChecked: Date.now(),
      transport: "native",
      hostName: NATIVE_HOST_NAME,
      error: lastTransportError,
    })
    scheduleReconnect()
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

    scheduleReconnect()
  })
}

export function connectAnybox() {
  if (activeTransport || connecting) return
  connectNativeTransport()
}

export function getBridgeStatusStorageKey() {
  return STATUS_STORAGE_KEY
}
