import type { SidebarActionKey } from "./types"

export const DEFAULT_SIDEBAR_WIDTH = 236
export const MIN_SIDEBAR_WIDTH = 192
export const MAX_SIDEBAR_WIDTH = 420
export const DEFAULT_RIGHT_SIDEBAR_WIDTH = 480
export const MIN_RIGHT_SIDEBAR_WIDTH = 280
export const MAX_RIGHT_SIDEBAR_WIDTH = 4096
export const MIN_CANVAS_WIDTH = 560
export const SIDEBAR_RESIZER_WIDTH = 10
export const RIGHT_SIDEBAR_MIN_LEFT_EDGE_RATIO = 1 / 3
export const SIDEBAR_KEYBOARD_STEP = 16
export const STREAM_PENDING_PREFIX = "Queued prompt:"
export const STREAM_PENDING_REASONING = "Reasoning updates will appear here as soon as the backend emits them."
export const STREAM_PENDING_NEXT_STEP = "Live output will keep appending inside this turn while the backend responds."

export const sidebarActions: Array<{ key: SidebarActionKey; label: string }> = [
  { key: "project", label: "Open folder" },
]
