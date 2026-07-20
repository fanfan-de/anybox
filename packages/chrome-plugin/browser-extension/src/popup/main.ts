import { STATUS_STORAGE_KEY } from "../shared/status"
import type {
  BridgeStatus,
  BrowserControlSummary,
} from "../shared/status"
import {
  cleanupPresentation,
  controlPresentation,
  getPopupMessages,
  resolvePopupLocale,
  statusPresentation,
  timePresentation,
} from "./model"
import "./style.css"

const locale = resolvePopupLocale(
  chrome.i18n?.getUILanguage?.() || navigator.language,
)
const copy = getPopupMessages(locale)
document.documentElement.lang = locale

const statusDot = document.querySelector<HTMLSpanElement>("#status-dot")
const statusLabel = document.querySelector<HTMLElement>("#status-label")
const statusDetail = document.querySelector<HTMLElement>("#status-detail")
const controlDetail = document.querySelector<HTMLElement>("#control-detail")
const controlBadge = document.querySelector<HTMLElement>("#control-badge")
const statusProtocol = document.querySelector<HTMLElement>("#status-protocol")
const statusReconnects = document.querySelector<HTMLElement>("#status-reconnects")
const statusChecked = document.querySelector<HTMLElement>("#status-checked")
const statusCleanup = document.querySelector<HTMLElement>("#status-cleanup")
const controlButton = document.querySelector<HTMLButtonElement>("#control-button")
const reconnectButton = document.querySelector<HTMLButtonElement>("#reconnect-button")
const actionFeedback = document.querySelector<HTMLElement>("#action-feedback")

let currentStatus: BridgeStatus | undefined
let currentControl: BrowserControlSummary | undefined
let busyAction: "control" | "reconnect" | undefined

function setText(selector: string, value: string) {
  const element = document.querySelector<HTMLElement>(selector)
  if (element) element.textContent = value
}

function applyStaticCopy() {
  setText("#popup-subtitle", copy.subtitle)
  setText("#control-title", copy.browserControl)
  setText("#diagnostics-summary", copy.diagnostics)
  setText("#protocol-label", copy.protocol)
  setText("#reconnects-label", copy.reconnects)
  setText("#checked-label", copy.lastChecked)
  setText("#cleanup-label", copy.lastCleanup)
}

function render() {
  const status = statusPresentation(currentStatus, locale)
  const control = controlPresentation(currentControl, locale)
  document.body.dataset.state = status.state
  document.body.dataset.control = control.paused ? "paused" : "running"

  if (statusLabel) statusLabel.textContent = status.label
  if (statusDetail) statusDetail.textContent = status.detail
  if (statusDot) statusDot.title = status.label
  if (controlDetail) controlDetail.textContent = control.detail
  if (controlBadge) {
    controlBadge.textContent = control.badge
    controlBadge.hidden = !control.badge
  }

  if (statusProtocol) {
    statusProtocol.textContent = currentStatus?.protocolVersion
      ? `IPC v${currentStatus.protocolVersion}${
          currentStatus.contractVersion
            ? ` · Contract v${currentStatus.contractVersion}`
            : ""
        }`
      : copy.never
  }
  if (statusReconnects) {
    statusReconnects.textContent = String(currentStatus?.reconnectCount ?? 0)
  }
  if (statusChecked) {
    statusChecked.textContent = timePresentation(
      currentStatus?.lastChecked,
      locale,
    )
  }
  if (statusCleanup) {
    statusCleanup.textContent = cleanupPresentation(currentStatus, locale)
  }

  if (controlButton) {
    controlButton.disabled = Boolean(busyAction) || !currentControl
    controlButton.textContent = busyAction === "control"
      ? control.paused ? copy.resuming : copy.stopping
      : control.paused ? copy.resumeControl : copy.stopControl
    controlButton.dataset.intent = control.paused ? "resume" : "stop"
  }
  if (reconnectButton) {
    reconnectButton.disabled = Boolean(busyAction)
      || currentStatus?.state !== "disconnected"
    reconnectButton.textContent = busyAction === "reconnect"
      ? copy.reconnecting
      : copy.reconnect
  }
}

function showFeedback(message: string, tone: "neutral" | "error" = "neutral") {
  if (!actionFeedback) return
  actionFeedback.textContent = message
  actionFeedback.dataset.tone = tone
  actionFeedback.hidden = false
}

function clearFeedback() {
  if (!actionFeedback) return
  actionFeedback.hidden = true
  actionFeedback.textContent = ""
  delete actionFeedback.dataset.tone
}

function isControlSummary(value: unknown): value is BrowserControlSummary {
  if (!value || typeof value !== "object") return false
  const summary = value as Partial<BrowserControlSummary>
  return typeof summary.paused === "boolean"
    && typeof summary.activeTabs === "number"
    && typeof summary.handoffTabs === "number"
    && typeof summary.agentTabs === "number"
    && typeof summary.userTabs === "number"
    && typeof summary.sessionCount === "number"
    && typeof summary.updatedAt === "number"
}

async function loadStatus() {
  const stored = await chrome.storage.local.get(STATUS_STORAGE_KEY)
  currentStatus = stored[STATUS_STORAGE_KEY] as BridgeStatus | undefined
  render()
}

async function loadControl() {
  const response = await chrome.runtime.sendMessage({
    type: "ANYBOX_GET_CONTROL_STATUS",
  }).catch(() => undefined)
  if (isControlSummary(response)) {
    currentControl = response
    render()
  }
}

controlButton?.addEventListener("click", async () => {
  if (!currentControl || busyAction) return
  const paused = !currentControl.paused
  busyAction = "control"
  clearFeedback()
  render()
  try {
    const response = await chrome.runtime.sendMessage({
      type: "ANYBOX_SET_CONTROL_PAUSED",
      paused,
    }) as { ok?: boolean; summary?: unknown; error?: string } | undefined
    if (!response?.ok || !isControlSummary(response.summary)) {
      throw new Error(response?.error || copy.actionFailed)
    }
    currentControl = response.summary
    currentStatus = {
      ...(currentStatus ?? {
        state: "disconnected",
        lastChecked: Date.now(),
      }),
      controlPaused: paused,
    }
    showFeedback(paused ? copy.stoppedFeedback : copy.resumedFeedback)
  } catch (error) {
    showFeedback(
      error instanceof Error ? error.message : copy.actionFailed,
      "error",
    )
  } finally {
    busyAction = undefined
    render()
  }
})

reconnectButton?.addEventListener("click", async () => {
  if (busyAction || currentStatus?.state !== "disconnected") return
  busyAction = "reconnect"
  clearFeedback()
  currentStatus = {
    ...currentStatus,
    state: "connecting",
    lastChecked: Date.now(),
    error: undefined,
  }
  render()
  try {
    const response = await chrome.runtime.sendMessage({
      type: "ANYBOX_RECONNECT_BRIDGE",
    }) as { ok?: boolean } | undefined
    if (!response?.ok) throw new Error(copy.actionFailed)
    showFeedback(copy.reconnectFeedback)
    window.setTimeout(() => {
      void Promise.all([loadStatus(), loadControl()])
    }, 500)
  } catch (error) {
    showFeedback(
      error instanceof Error ? error.message : copy.actionFailed,
      "error",
    )
  } finally {
    busyAction = undefined
    render()
  }
})

chrome.storage.onChanged.addListener((
  changes: Record<string, { newValue?: unknown }>,
  areaName: string,
) => {
  if (areaName === "local") {
    const next = changes[STATUS_STORAGE_KEY]?.newValue
    if (next && typeof next === "object") {
      currentStatus = next as BridgeStatus
      render()
    }
    return
  }
  if (areaName === "session") {
    void loadControl()
  }
})

applyStaticCopy()
render()
void Promise.all([loadStatus(), loadControl()])
