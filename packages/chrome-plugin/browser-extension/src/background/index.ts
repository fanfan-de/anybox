import { connectAnybox, getBridgeStatusStorageKey } from "./anybox-client"

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
