import type { ToolCallOutcome, ToolCallSnapshot } from "@anybox/shared"

export type ToolCallVisualKey =
  | "pending"
  | "running"
  | "waiting-approval"
  | "returned"
  | "returned-negative"
  | "returned-partial"
  | "blocked"
  | "denied"
  | "cancelled"
  | "timeout"
  | "failed"

export type ToolCallVisualTone = "idle" | "active" | "success" | "warning" | "muted" | "danger"

export interface ToolCallVisualState {
  key: ToolCallVisualKey
  tone: ToolCallVisualTone
  active: boolean
}

export function toolCallOutcome(call: ToolCallSnapshot | undefined): ToolCallOutcome | undefined {
  return call?.state.phase === "settled" ? call.state.outcome : undefined
}

export function toolCallIsSettled(call: ToolCallSnapshot | undefined) {
  return call?.state.phase === "settled"
}

export function toolCallIsActive(call: ToolCallSnapshot | undefined) {
  return Boolean(call && call.state.phase !== "settled")
}

export function toolCallIsWaitingApproval(call: ToolCallSnapshot | undefined) {
  return call?.state.phase === "waiting-approval"
}

export function projectToolCallVisualState(call: ToolCallSnapshot | undefined): ToolCallVisualState {
  if (!call || call.state.phase === "pending") return { key: "pending", tone: "idle", active: true }
  if (call.state.phase === "running") return { key: "running", tone: "active", active: true }
  if (call.state.phase === "waiting-approval") {
    return { key: "waiting-approval", tone: "warning", active: true }
  }

  const outcome = call.state.outcome
  if (outcome.kind === "returned") {
    if (outcome.result === "negative") {
      return { key: "returned-negative", tone: "warning", active: false }
    }
    if (outcome.completeness === "partial") {
      return { key: "returned-partial", tone: "warning", active: false }
    }
    return { key: "returned", tone: "success", active: false }
  }
  if (outcome.kind === "failed") return { key: "failed", tone: "danger", active: false }
  if (outcome.kind === "timeout") return { key: "timeout", tone: "warning", active: false }
  if (outcome.kind === "blocked") return { key: "blocked", tone: "muted", active: false }
  return { key: outcome.kind, tone: "muted", active: false }
}
