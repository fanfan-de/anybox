import type {
  BridgeStatus,
  BrowserControlSummary,
} from "../shared/status"

export type PopupLocale = "en-US" | "zh-CN"

type PopupMessages = {
  subtitle: string
  checking: string
  connected: string
  connecting: string
  disconnected: string
  connectedDetail: string
  connectingDetail: string
  disconnectedDetail: string
  browserControl: string
  controlLoading: string
  controlIdle: string
  controlPaused: string
  controlActive: (active: number, handoff: number) => string
  tabs: (count: number) => string
  stopControl: string
  resumeControl: string
  stopping: string
  resuming: string
  reconnect: string
  reconnecting: string
  diagnostics: string
  protocol: string
  reconnects: string
  lastChecked: string
  lastCleanup: string
  never: string
  cleanup: (
    closed: number,
    released: number,
    deliverable: number,
    handoff: number,
  ) => string
  stoppedFeedback: string
  resumedFeedback: string
  reconnectFeedback: string
  actionFailed: string
}

const messages: Record<PopupLocale, PopupMessages> = {
  "en-US": {
    subtitle: "Browser bridge",
    checking: "Checking",
    connected: "Connected",
    connecting: "Connecting",
    disconnected: "Disconnected",
    connectedDetail: "Anybox can use this Chrome profile.",
    connectingDetail: "Connecting to the Anybox Browser Host…",
    disconnectedDetail: "Reconnect after starting Chrome control in Anybox.",
    browserControl: "Browser control",
    controlLoading: "Checking active browser tasks…",
    controlIdle: "No tabs are currently controlled.",
    controlPaused: "Control is stopped. Existing tabs stay open.",
    controlActive: (active, handoff) =>
      `${active} active${handoff > 0 ? ` · ${handoff} handed off` : ""}`,
    tabs: (count) => `${count} ${count === 1 ? "tab" : "tabs"}`,
    stopControl: "Stop control",
    resumeControl: "Resume control",
    stopping: "Stopping…",
    resuming: "Resuming…",
    reconnect: "Reconnect",
    reconnecting: "Reconnecting…",
    diagnostics: "Diagnostics",
    protocol: "Protocol",
    reconnects: "Reconnects",
    lastChecked: "Last checked",
    lastCleanup: "Last cleanup",
    never: "—",
    cleanup: (closed, released, deliverable, handoff) =>
      `${closed} closed · ${released} released · ${deliverable} delivered · ${handoff} handed off`,
    stoppedFeedback: "Control stopped. Any open tabs were preserved.",
    resumedFeedback: "Browser control resumed.",
    reconnectFeedback: "Reconnect requested.",
    actionFailed: "The action could not be completed.",
  },
  "zh-CN": {
    subtitle: "浏览器桥接",
    checking: "正在检查",
    connected: "已连接",
    connecting: "正在连接",
    disconnected: "未连接",
    connectedDetail: "Anybox 可以使用此 Chrome 配置文件。",
    connectingDetail: "正在连接 Anybox Browser Host…",
    disconnectedDetail: "在 Anybox 中启动 Chrome 控制后再重连。",
    browserControl: "浏览器控制",
    controlLoading: "正在检查浏览器任务…",
    controlIdle: "当前没有正在控制的标签页。",
    controlPaused: "控制已停止；现有标签页会保持打开。",
    controlActive: (active, handoff) =>
      `${active} 个活动标签页${handoff > 0 ? ` · ${handoff} 个已交接` : ""}`,
    tabs: (count) => `${count} 个标签页`,
    stopControl: "停止控制",
    resumeControl: "恢复控制",
    stopping: "正在停止…",
    resuming: "正在恢复…",
    reconnect: "重新连接",
    reconnecting: "正在重连…",
    diagnostics: "诊断信息",
    protocol: "协议",
    reconnects: "重连次数",
    lastChecked: "上次检查",
    lastCleanup: "上次清理",
    never: "—",
    cleanup: (closed, released, deliverable, handoff) =>
      `${closed} 个已关闭 · ${released} 个已释放 · ${deliverable} 个已交付 · ${handoff} 个已交接`,
    stoppedFeedback: "控制已停止，打开的标签页均已保留。",
    resumedFeedback: "浏览器控制已恢复。",
    reconnectFeedback: "已请求重新连接。",
    actionFailed: "操作未能完成。",
  },
}

export function resolvePopupLocale(language?: string): PopupLocale {
  return language?.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US"
}

export function getPopupMessages(locale: PopupLocale) {
  return messages[locale]
}

export function statusPresentation(
  status: BridgeStatus | null | undefined,
  locale: PopupLocale,
) {
  const copy = messages[locale]
  const state = status?.state ?? "disconnected"
  const label = state === "connected"
    ? copy.connected
    : state === "connecting"
      ? copy.connecting
      : status
        ? copy.disconnected
        : copy.checking
  const fallbackDetail = state === "connected"
    ? copy.connectedDetail
    : state === "connecting"
      ? copy.connectingDetail
      : copy.disconnectedDetail
  const compactError = status?.error?.replace(/\s+/g, " ").trim().slice(0, 180)
  return {
    state,
    label,
    detail: compactError || fallbackDetail,
  }
}

export function controlPresentation(
  summary: BrowserControlSummary | null | undefined,
  locale: PopupLocale,
) {
  const copy = messages[locale]
  if (!summary) {
    return {
      detail: copy.controlLoading,
      badge: "",
      paused: false,
      totalTabs: 0,
    }
  }
  const totalTabs = summary.activeTabs + summary.handoffTabs
  return {
    detail: summary.paused
      ? copy.controlPaused
      : totalTabs > 0
        ? copy.controlActive(summary.activeTabs, summary.handoffTabs)
        : copy.controlIdle,
    badge: totalTabs > 0 ? copy.tabs(totalTabs) : "",
    paused: summary.paused,
    totalTabs,
  }
}

export function cleanupPresentation(
  status: BridgeStatus | null | undefined,
  locale: PopupLocale,
) {
  const cleanup = status?.cleanup
  if (!cleanup) return messages[locale].never
  return messages[locale].cleanup(
    cleanup.closed,
    cleanup.released,
    cleanup.deliverable,
    cleanup.handoff,
  )
}

export function timePresentation(
  timestamp: number | undefined,
  locale: PopupLocale,
) {
  if (!timestamp) return messages[locale].never
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(timestamp)
}
