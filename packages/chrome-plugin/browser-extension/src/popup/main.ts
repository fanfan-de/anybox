import { STATUS_STORAGE_KEY } from "../shared/status"
import "./style.css"

const statusDot = document.querySelector<HTMLSpanElement>("#status-dot")
const statusLabel = document.querySelector<HTMLElement>("#status-label")
const statusDetail = document.querySelector<HTMLElement>("#status-detail")
const statusMetrics = document.querySelector<HTMLElement>("#status-metrics")
const statusProtocol = document.querySelector<HTMLElement>("#status-protocol")
const statusReconnects = document.querySelector<HTMLElement>("#status-reconnects")
const statusCleanup = document.querySelector<HTMLElement>("#status-cleanup")
const reconnectButton = document.querySelector<HTMLButtonElement>("#reconnect-button")

type Status = {
  state?: "connected" | "connecting" | "disconnected"
  transport?: "native"
  hostName?: string
  error?: string
  lastChecked?: number
  protocolVersion?: number
  contractVersion?: number
  reconnectCount?: number
  cleanup?: {
    closed: number
    released: number
    retained: number
    detached: number
    completedAt: number
  }
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
      : "Anybox Browser Host"
    statusDetail.textContent = status?.error
      ? status.error
      : state === "connected"
        ? `${transportDetail} can use this Chrome profile.`
        : state === "connecting"
          ? `Connecting via ${transportDetail}...`
          : "Start Chrome control in Anybox, then reconnect."
  }
  if (statusDot) {
    statusDot.title = state
  }
  if (statusMetrics) {
    statusMetrics.hidden = !status
  }
  if (statusProtocol) {
    statusProtocol.textContent = status?.protocolVersion
      ? `IPC v${status.protocolVersion}${
          status.contractVersion ? ` · Contract v${status.contractVersion}` : ""
        }`
      : "—"
  }
  if (statusReconnects) {
    statusReconnects.textContent = String(status?.reconnectCount ?? 0)
  }
  if (statusCleanup) {
    const cleanup = status?.cleanup
    statusCleanup.textContent = cleanup
      ? `${cleanup.closed} closed · ${cleanup.released} released · ${cleanup.retained} kept`
      : "—"
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
