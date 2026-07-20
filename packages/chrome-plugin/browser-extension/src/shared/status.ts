export const STATUS_STORAGE_KEY = "ANYBOX_BRIDGE_STATUS"
export const EXTENSION_INSTANCE_KEY = "ANYBOX_EXTENSION_INSTANCE_ID"
export const CONTROL_PAUSED_STORAGE_KEY = "ANYBOX_CONTROL_PAUSED"

export type BridgeStatus = {
  state: "connected" | "disconnected" | "connecting"
  lastChecked: number
  controlPaused?: boolean
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
    deliverable: number
    handoff: number
    detached: number
    completedAt: number
  }
}

export type BrowserControlSummary = {
  paused: boolean
  activeTabs: number
  handoffTabs: number
  agentTabs: number
  userTabs: number
  sessionCount: number
  updatedAt: number
}
