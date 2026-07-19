export type PermissionRequestStatus = "pending" | "approved" | "denied" | "expired"
export type PermissionRisk = "low" | "medium" | "high" | "critical"
export type ToolPermissionMode = "default" | "full_access"
export type PermissionToolKind =
  | "read"
  | "write"
  | "search"
  | "exec"
  | "workflow"
  | "interaction"
  | "delegation"
  | "other"
export type PermissionDecision = "allow" | "allow-once" | "allow-session" | "deny"
export type PermissionContinuation = "tool-retry" | "in-process"

export interface PermissionPromptDetails {
  paths?: string[]
  command?: string
  workdir?: string
  body?: string
}

export interface PermissionPromptSnapshot {
  title: string
  summary: string
  rationale: string
  risk: PermissionRisk
  detailsAvailable: boolean
  details?: PermissionPromptDetails
  allowedDecisions: PermissionDecision[]
  recommendedDecision: PermissionDecision
}

export interface PermissionRequestResolutionRecord {
  decision: PermissionDecision
  note?: string
  approved: boolean
  resolvedAt: number
}

export interface PermissionRequestPrompt {
  id: string
  approvalID: string
  sessionID: string
  messageID: string
  toolCallID: string
  projectID: string
  agent: string
  status: PermissionRequestStatus
  createdAt: number
  turnID?: string
  continuation?: PermissionContinuation
  scope?: {
    kind: "browser-origin"
    sessionID: string
    extensionInstanceID: string
    origin: string
    browserID?: string
  }
  grantID?: string
  prompt: PermissionPromptSnapshot
  resolution?: PermissionRequestResolutionRecord
}

export interface PermissionResolveInput {
  requestID: string
  decision: PermissionDecision
  note?: string
  resume?: boolean
}

export interface PermissionResolveResult {
  request?: PermissionRequestPrompt
  resumed?: unknown
}

export interface ToolPermissionModePayload {
  mode: ToolPermissionMode
}

export function isAllowDecision(decision: PermissionDecision) {
  return decision !== "deny"
}

export function getPermissionDecisionLabel(decision: PermissionDecision) {
  switch (decision) {
    case "allow":
      return "Allow"
    case "allow-once":
      return "Allow once"
    case "allow-session":
      return "Allow for session"
    case "deny":
      return "Deny"
  }
}
