import {
  connectAnybox,
  getBrowserControlSummary,
  getBridgeStatusStorageKey,
  getExtensionInstanceID,
  setBrowserControlPaused,
} from "./anybox-client"
import { installLeaseInheritance } from "./lease-store"
import {
  groupAgentTab,
  initializeManagedTabGroups,
  installTabGroupLifecycle,
} from "./tab-group-store"

installTabGroupLifecycle()
void initializeManagedTabGroups()
installLeaseInheritance(getExtensionInstanceID, groupAgentTab)
connectAnybox()

chrome.runtime.onInstalled.addListener(() => {
  connectAnybox()
})

chrome.runtime.onStartup.addListener(() => {
  connectAnybox()
})

chrome.runtime.onMessage.addListener((message: unknown, _sender: unknown, sendResponse: (response: unknown) => void) => {
  if (!message || typeof message !== "object") return false
  const request = message as { type?: string; paused?: unknown }
  if (request.type === "ANYBOX_GET_BRIDGE_STATUS") {
    chrome.storage.local.get(getBridgeStatusStorageKey()).then((value: Record<string, unknown>) => {
      sendResponse(value[getBridgeStatusStorageKey()] ?? { state: "disconnected", lastChecked: Date.now() })
    })
    return true
  }
  if (request.type === "ANYBOX_GET_CONTROL_STATUS") {
    void getBrowserControlSummary().then(
      sendResponse,
      (error) => sendResponse({
        error: error instanceof Error ? error.message : String(error),
      }),
    )
    return true
  }
  if (request.type === "ANYBOX_SET_CONTROL_PAUSED") {
    if (typeof request.paused !== "boolean") {
      sendResponse({ ok: false, error: "The paused state must be a boolean." })
      return false
    }
    void setBrowserControlPaused(request.paused).then(
      (summary) => sendResponse({ ok: true, summary }),
      (error) => sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    )
    return true
  }
  if (request.type === "ANYBOX_RECONNECT_BRIDGE") {
    connectAnybox()
    sendResponse({ ok: true })
    return true
  }
  return false
})
