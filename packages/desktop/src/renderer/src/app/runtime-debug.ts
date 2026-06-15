import type { SessionRuntimeDebugSnapshot, SessionRuntimeDebugState, SessionSummary } from "./types"
import { normalizeAppLocale, type AppLocale } from "../../../shared/locale"
import { t as translate, type TranslationKey } from "./i18n/translations"
import { formatTime } from "./utils"

function getRuntimeLocale(): AppLocale {
  if (typeof document === "undefined") return "zh-CN"
  return normalizeAppLocale(document.documentElement.lang)
}

function runtimeT(key: TranslationKey, params?: Record<string, string | number>) {
  return translate(getRuntimeLocale(), key, params)
}

export function formatRuntimeLoadStateLabel(status: SessionRuntimeDebugState["status"]) {
  switch (status) {
    case "loading":
      return runtimeT("runtime.load.loading")
    case "refreshing":
      return runtimeT("runtime.load.refreshing")
    case "ready":
      return runtimeT("runtime.load.synced")
    case "error":
      return runtimeT("runtime.load.refreshFailed")
    default:
      return runtimeT("runtime.load.idle")
  }
}

export function formatRuntimeBusyStateLabel(status: SessionRuntimeDebugSnapshot["status"]["type"]) {
  return status === "busy" ? runtimeT("runtime.busy.busy") : runtimeT("runtime.busy.idle")
}

export function formatRuntimePhaseLabel(phase?: SessionRuntimeDebugSnapshot["status"]["phase"]) {
  switch (phase) {
    case "preparing":
      return runtimeT("runtime.phase.preparing")
    case "waiting_llm":
      return runtimeT("runtime.phase.waitingLlm")
    case "reasoning":
      return runtimeT("runtime.phase.reasoning")
    case "executing_tool":
      return runtimeT("runtime.phase.runningTool")
    case "waiting_approval":
      return runtimeT("runtime.phase.waitingApproval")
    case "responding":
      return runtimeT("runtime.phase.responding")
    case "retrying":
      return runtimeT("runtime.phase.retrying")
    case "blocked":
      return runtimeT("runtime.phase.blocked")
    case "continued_by_user":
      return runtimeT("runtime.phase.continuedByUser")
    case "completed":
      return runtimeT("runtime.phase.completed")
    case "cancelled":
      return runtimeT("runtime.phase.cancelled")
    case "failed":
      return runtimeT("runtime.phase.failed")
    default:
      return runtimeT("runtime.phase.unknown")
  }
}

export function formatRuntimeTurnStatusLabel(status?: SessionRuntimeDebugSnapshot["turns"][number]["status"]) {
  switch (status) {
    case "running":
      return runtimeT("automations.status.running")
    case "completed":
      return runtimeT("runtime.phase.completed")
    case "blocked":
      return runtimeT("runtime.phase.blocked")
    case "continued_by_user":
      return runtimeT("runtime.phase.continuedByUser")
    case "failed":
      return runtimeT("runtime.phase.failed")
    case "stopped":
      return runtimeT("connections.mobile.stopped")
    default:
      return runtimeT("runtime.load.idle")
  }
}

export function formatRuntimeDuration(durationMs?: number) {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs)) return "—"
  if (durationMs < 1000) return `${durationMs} ms`
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(durationMs >= 10_000 ? 0 : 1)} s`
  const minutes = Math.floor(durationMs / 60_000)
  const seconds = Math.round((durationMs % 60_000) / 1000)
  return `${minutes}m ${seconds}s`
}

export function buildRuntimeStatusDescription(input: {
  activeSession: SessionSummary | null
  runtimeState: SessionRuntimeDebugState
  runtimeSnapshot: SessionRuntimeDebugSnapshot | null
}) {
  if (!input.activeSession) {
    return runtimeT("runtime.description.selectSession")
  }

  if (input.runtimeState.status === "loading") {
    return runtimeT("runtime.description.loading")
  }

  if (input.runtimeState.status === "refreshing") {
    return input.runtimeState.updatedAt
      ? runtimeT("runtime.description.refreshingWithTime", { time: formatTime(input.runtimeState.updatedAt) })
      : runtimeT("runtime.description.refreshing")
  }

  if (input.runtimeState.status === "error") {
    return input.runtimeState.updatedAt
      ? runtimeT("runtime.description.refreshFailedWithTime", { time: formatTime(input.runtimeState.updatedAt) })
      : runtimeT("runtime.description.refreshFailed")
  }

  const latestTurn = input.runtimeSnapshot?.latestTurn
  if (input.runtimeSnapshot?.status.type === "busy" && latestTurn) {
    return runtimeT("runtime.description.phaseInProgress", {
      phase: formatRuntimePhaseLabel(input.runtimeSnapshot.status.phase ?? latestTurn.phase),
    })
  }

  if (latestTurn?.status === "failed") {
    return latestTurn.errorContext?.error.message ?? latestTurn.error?.message ?? runtimeT("runtime.description.latestTurnFailed")
  }

  if (input.runtimeSnapshot?.diagnostics.blockedOnApproval) {
    return runtimeT("runtime.description.blockedOnApproval")
  }

  if (input.runtimeState.updatedAt) {
    return runtimeT("runtime.description.lastSyncedAt", { time: formatTime(input.runtimeState.updatedAt) })
  }

  return runtimeT("runtime.description.inspect")
}
