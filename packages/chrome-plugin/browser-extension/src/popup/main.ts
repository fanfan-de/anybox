import { STATUS_STORAGE_KEY } from "../shared/status"
import "./style.css"

const statusDot = document.querySelector<HTMLSpanElement>("#status-dot")
const statusLabel = document.querySelector<HTMLElement>("#status-label")
const statusDetail = document.querySelector<HTMLElement>("#status-detail")
const reconnectButton = document.querySelector<HTMLButtonElement>("#reconnect-button")

type Status = {
  state?: "connected" | "connecting" | "disconnected"
  transport?: "native" | "websocket"
  hostName?: string
  error?: string
  lastChecked?: number
}

function renderStatus(status: Status | null | undefined) {
  const state = status?.state ?? "disconnected"
  document.body.dataset.state = state
  if (statusLabel) {
    statusLabel.textContent = state === "connected" ? "Connected" : state === "connecting" ? "Connecting" : "Disconnected"
  }
  if (statusDetail) {
    const transportDetail = status?.transport === "native"
      ? `Native Messaging (${status.hostName ?? "host"})`
      : status?.transport === "websocket"
        ? "WebSocket fallback"
        : "Anybox Agent"
    statusDetail.textContent = status?.error
      ? status.error
      : state === "connected"
        ? `${transportDetail} can use this Chrome profile.`
        : state === "connecting"
          ? `Connecting via ${transportDetail}...`
          : "Start Anybox Agent, then reconnect."
  }
  if (statusDot) {
    statusDot.title = state
  }
}

async function loadStatus() {
  await chrome.runtime.sendMessage({ type: "ANYBOX_RECONNECT_BRIDGE" }).catch(() => undefined)
  const key = getBridgeStatusStorageKey()
  const stored = await chrome.storage.local.get(key)
  renderStatus(stored[key] as Status | undefined)
}

reconnectButton?.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "ANYBOX_RECONNECT_BRIDGE" })
  renderStatus({ state: "connecting" })
  window.setTimeout(() => {
    void loadStatus()
  }, 500)
})

chrome.storage.onChanged.addListener((changes: Record<string, { newValue?: unknown }>, areaName: string) => {
  if (areaName !== "local") return
  const next = changes[getBridgeStatusStorageKey()]?.newValue
  if (next) renderStatus(next as Status)
})

void loadStatus()

function getBridgeStatusStorageKey() {
  return STATUS_STORAGE_KEY
}
