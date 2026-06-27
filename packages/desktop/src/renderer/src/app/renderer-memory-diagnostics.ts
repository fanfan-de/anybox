import type {
  DesktopRendererMemoryDiagnosticsSnapshot,
  DesktopRendererMemoryHeapSnapshot,
  DesktopRendererPerformanceEntryCounts,
  DesktopRendererSessionMemoryDiagnostics,
} from "../../../shared/desktop-ipc-contract"
import type { SessionMessageTree } from "./session-message-tree"
import type {
  AssistantTraceFileChange,
  AssistantTraceItem,
  AssistantThreadMessage,
  SessionDiffSummary,
  ThreadMessage,
} from "./types"

interface RendererDiagnosticsApi {
  getSnapshot: (reason?: string) => DesktopRendererMemoryDiagnosticsSnapshot
  report: (reason?: string) => void
  updateCurrentSession: (diagnostics: DesktopRendererSessionMemoryDiagnostics) => void
}

declare global {
  interface Window {
    __ANYBOX_RENDERER_DIAGNOSTICS__?: RendererDiagnosticsApi
  }
}

type PerformanceWithMemory = Performance & {
  memory?: {
    jsHeapSizeLimit?: number
    totalJSHeapSize?: number
    usedJSHeapSize?: number
  }
}

const EMPTY_SESSION_DIAGNOSTICS: DesktopRendererSessionMemoryDiagnostics = {
  assistantMessageCount: 0,
  currentSessionID: null,
  diffChars: 0,
  draftPatchChars: 0,
  maxTraceItemChars: 0,
  messageTreeContentChars: 0,
  messageTreeNodeCount: 0,
  streamingAssistantMessageCount: 0,
  toolInputChars: 0,
  toolOutputChars: 0,
  traceItemCount: 0,
  traceTextChars: 0,
  messageCount: 0,
  updatedAt: 0,
}

const DIAGNOSTIC_REPORT_INTERVAL_MS = 30_000
const DIAGNOSTIC_REPORT_THROTTLE_MS = 5_000

let currentSessionDiagnostics = EMPTY_SESSION_DIAGNOSTICS
let diagnosticsInstalled = false
let diagnosticsReportTimerID: number | null = null
let lastDiagnosticsReportAt = 0

function stringLength(value: string | null | undefined) {
  return value?.length ?? 0
}

function getPerformanceEntryCount(type: string) {
  if (typeof performance === "undefined" || typeof performance.getEntriesByType !== "function") return 0

  try {
    return performance.getEntriesByType(type).length
  } catch {
    return 0
  }
}

function readPerformanceEntryCounts(): DesktopRendererPerformanceEntryCounts {
  const counts = {
    mark: getPerformanceEntryCount("mark"),
    measure: getPerformanceEntryCount("measure"),
    navigation: getPerformanceEntryCount("navigation"),
    paint: getPerformanceEntryCount("paint"),
    resource: getPerformanceEntryCount("resource"),
  }
  const total = (() => {
    if (typeof performance === "undefined" || typeof performance.getEntries !== "function") return 0
    try {
      return performance.getEntries().length
    } catch {
      return Object.values(counts).reduce((sum, count) => sum + count, 0)
    }
  })()

  return {
    ...counts,
    total,
  }
}

function readHeapSnapshot(): DesktopRendererMemoryHeapSnapshot {
  if (typeof performance === "undefined") return {}
  const memory = (performance as PerformanceWithMemory).memory
  if (!memory) return {}

  return {
    jsHeapSizeLimit: memory.jsHeapSizeLimit,
    totalJSHeapSize: memory.totalJSHeapSize,
    usedJSHeapSize: memory.usedJSHeapSize,
  }
}

function fileChangePatchChars(change: AssistantTraceFileChange) {
  let chars = stringLength(change.patch)
  for (const hunk of change.previewHunks ?? []) {
    chars += stringLength(hunk.header)
    for (const row of hunk.rows) {
      chars += stringLength(row.content)
    }
  }
  return chars
}

function traceItemSize(item: AssistantTraceItem) {
  let traceTextChars = 0
  let toolInputChars = 0
  let toolOutputChars = 0
  let draftPatchChars = 0
  let totalChars = 0

  const addTraceText = (value: string | undefined) => {
    const chars = stringLength(value)
    traceTextChars += chars
    totalChars += chars
  }

  addTraceText(item.text)
  addTraceText(item.detail)
  toolInputChars += stringLength(item.toolInputText)
  toolOutputChars += stringLength(item.toolOutputText)
  totalChars += toolInputChars + toolOutputChars

  for (const entry of item.debugEntries ?? []) {
    totalChars += stringLength(entry.label) + stringLength(entry.value)
  }

  for (const change of item.fileChanges ?? []) {
    const chars = fileChangePatchChars(change)
    draftPatchChars += chars
    totalChars += chars
  }

  for (const change of item.draftPatch?.fileChanges ?? []) {
    const chars = fileChangePatchChars(change)
    draftPatchChars += chars
    totalChars += chars
  }

  return {
    draftPatchChars,
    toolInputChars,
    toolOutputChars,
    totalChars,
    traceTextChars,
  }
}

function sessionDiffChars(diff: SessionDiffSummary | null | undefined) {
  if (!diff) return 0
  return diff.diffs.reduce((sum, change) => sum + stringLength(change.patch), 0)
}

function messageTreeStats(messageTree: SessionMessageTree | null | undefined) {
  if (!messageTree) {
    return {
      messageTreeContentChars: 0,
      messageTreeNodeCount: 0,
    }
  }

  let messageTreeContentChars = 0
  const nodes = Object.values(messageTree.nodesByID)
  for (const node of nodes) {
    messageTreeContentChars += stringLength(node.content) + stringLength(node.preview)
  }

  return {
    messageTreeContentChars,
    messageTreeNodeCount: nodes.length,
  }
}

export function buildRendererSessionMemoryDiagnostics(input: {
  diffSummary?: SessionDiffSummary | null
  messageTree?: SessionMessageTree | null
  sessionID?: string | null
  messages: ThreadMessage[]
}): DesktopRendererSessionMemoryDiagnostics {
  let assistantMessageCount = 0
  let draftPatchChars = 0
  let maxTraceItemChars = 0
  let streamingAssistantMessageCount = 0
  let toolInputChars = 0
  let toolOutputChars = 0
  let traceItemCount = 0
  let traceTextChars = 0

  for (const message of input.messages) {
    if (message.kind !== "assistant") continue
    const assistantMessage = message as AssistantThreadMessage
    assistantMessageCount += 1
    if (assistantMessage.isStreaming) streamingAssistantMessageCount += 1
    traceItemCount += assistantMessage.items.length

    for (const item of assistantMessage.items) {
      const size = traceItemSize(item)
      draftPatchChars += size.draftPatchChars
      maxTraceItemChars = Math.max(maxTraceItemChars, size.totalChars)
      toolInputChars += size.toolInputChars
      toolOutputChars += size.toolOutputChars
      traceTextChars += size.traceTextChars
    }
  }

  return {
    assistantMessageCount,
    currentSessionID: input.sessionID ?? null,
    diffChars: sessionDiffChars(input.diffSummary),
    draftPatchChars,
    maxTraceItemChars,
    ...messageTreeStats(input.messageTree),
    streamingAssistantMessageCount,
    toolInputChars,
    toolOutputChars,
    traceItemCount,
    traceTextChars,
    messageCount: input.messages.length,
    updatedAt: Date.now(),
  }
}

export function updateRendererCurrentSessionDiagnostics(diagnostics: DesktopRendererSessionMemoryDiagnostics) {
  currentSessionDiagnostics = diagnostics
}

export function getRendererMemoryDiagnosticsSnapshot(reason?: string): DesktopRendererMemoryDiagnosticsSnapshot {
  return {
    currentSession: currentSessionDiagnostics,
    heap: readHeapSnapshot(),
    performanceEntries: readPerformanceEntryCounts(),
    reason,
    source: "renderer",
    timestamp: Date.now(),
    url: typeof window === "undefined" ? undefined : window.location.href,
    userAgent: typeof window === "undefined" ? undefined : window.navigator.userAgent,
  }
}

export function reportRendererMemoryDiagnostics(reason?: string, options: { force?: boolean } = {}) {
  if (typeof window === "undefined") return
  const now = Date.now()
  if (!options.force && now - lastDiagnosticsReportAt < DIAGNOSTIC_REPORT_THROTTLE_MS) return

  lastDiagnosticsReportAt = now
  const snapshot = getRendererMemoryDiagnosticsSnapshot(reason)
  void window.desktop?.reportRendererMemoryDiagnostics?.(snapshot).catch((error) => {
    console.warn("[desktop] renderer memory diagnostics report failed:", error)
  })
}

export function installRendererMemoryDiagnostics() {
  if (typeof window === "undefined" || diagnosticsInstalled) return
  diagnosticsInstalled = true

  window.__ANYBOX_RENDERER_DIAGNOSTICS__ = {
    getSnapshot: getRendererMemoryDiagnosticsSnapshot,
    report: (reason?: string) => reportRendererMemoryDiagnostics(reason, { force: true }),
    updateCurrentSession: updateRendererCurrentSessionDiagnostics,
  }
  reportRendererMemoryDiagnostics("install", { force: true })

  diagnosticsReportTimerID = window.setInterval(() => {
    reportRendererMemoryDiagnostics("interval")
  }, DIAGNOSTIC_REPORT_INTERVAL_MS)
}

export function uninstallRendererMemoryDiagnostics() {
  if (typeof window === "undefined") return
  if (diagnosticsReportTimerID !== null) {
    window.clearInterval(diagnosticsReportTimerID)
    diagnosticsReportTimerID = null
  }
  diagnosticsInstalled = false
  delete window.__ANYBOX_RENDERER_DIAGNOSTICS__
}
