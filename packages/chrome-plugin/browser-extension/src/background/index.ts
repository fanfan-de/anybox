import {
  connectAnybox,
  getBridgeStatusStorageKey,
  getExtensionInstanceID,
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
  if ((message as { type?: string }).type === "ANYBOX_GET_BRIDGE_STATUS") {
    connectAnybox()
    chrome.storage.local.get(getBridgeStatusStorageKey()).then((value: Record<string, unknown>) => {
      sendResponse(value[getBridgeStatusStorageKey()] ?? { state: "disconnected", lastChecked: Date.now() })
    })
    return true
  }
  if ((message as { type?: string }).type === "ANYBOX_RECONNECT_BRIDGE") {
    connectAnybox()
    sendResponse({ ok: true })
    return true
  }
  return false
})
