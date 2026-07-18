export const STATUS_STORAGE_KEY = "ANYBOX_BRIDGE_STATUS"
export const EXTENSION_INSTANCE_KEY = "ANYBOX_EXTENSION_INSTANCE_ID"

export type BridgeStatus = {
  state: "connected" | "disconnected" | "connecting"
  lastChecked: number
  transport?: "native" | "websocket"
  hostName?: string
  error?: string
}
