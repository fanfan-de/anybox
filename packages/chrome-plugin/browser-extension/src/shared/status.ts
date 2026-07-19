export const STATUS_STORAGE_KEY = "ANYBOX_BRIDGE_STATUS"
export const EXTENSION_INSTANCE_KEY = "ANYBOX_EXTENSION_INSTANCE_ID"

export type BridgeStatus = {
  state: "connected" | "disconnected" | "connecting"
  lastChecked: number
  transport?: "native"
  hostName?: string
  error?: string
  protocolVersion?: number
  contractVersion?: number
  browserID?: string
  reconnectCount?: number
  cleanup?: {
    closed: number
    released: number
    retained: number
    detached: number
    completedAt: number
  }
}
