import z from "zod"
import * as Identifier from "#id/id.ts"

export const Action = z.enum(["allow", "deny", "ask"]).meta({
  ref: "PermissionAction",
})
export type Action = z.infer<typeof Action>

export const Decision = z.preprocess((value) => {
  if (
    value === "allow-project" ||
    value === "allow-forever"
  ) {
    return "allow-session"
  }

  return value
}, z.enum(["allow", "allow-once", "allow-session", "deny"])).meta({
  ref: "PermissionDecision",
})
export type Decision = z.output<typeof Decision>

export const Continuation = z.enum(["tool-retry", "in-process"]).meta({
  ref: "PermissionContinuation",
})
export type Continuation = z.infer<typeof Continuation>

type BrowserOriginScope = {
  kind: "browser-origin"
  sessionID: string
  extensionInstanceID: string
  origin: string
  browserID?: string
}

type PluginActionScope = {
  kind: "plugin-action"
  sessionID: string
  pluginID: string
  pluginDisplayName: string
  actionTitle: string
  actionSummary: string
  actionBody?: string
}

export type Scope = BrowserOriginScope | PluginActionScope

export const Scope = z.object({
  kind: z.enum(["browser-origin", "plugin-action"]),
  sessionID: Identifier.schema("session"),
  extensionInstanceID: z.string().trim().min(1).max(256).optional(),
  origin: z.string().trim().min(1).max(2_048).optional(),
  browserID: z.string().trim().min(1).max(256).optional(),
  pluginID: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]*$/u).optional(),
  pluginDisplayName: z.string().trim().min(1).max(256).optional(),
  actionTitle: z.string().trim().min(1).max(256).optional(),
  actionSummary: z.string().trim().min(1).max(1_000).optional(),
  actionBody: z.string().trim().min(1).max(4_000).optional(),
}).strict().superRefine((scope, context) => {
  if (
    scope.kind === "browser-origin"
    && (!scope.extensionInstanceID || !scope.origin)
  ) {
    context.addIssue({
      code: "custom",
      message: "Browser origin scope requires extensionInstanceID and origin.",
    })
  }
  if (
    scope.kind === "plugin-action"
    && (
      !scope.pluginID
      || !scope.pluginDisplayName
      || !scope.actionTitle
      || !scope.actionSummary
    )
  ) {
    context.addIssue({
      code: "custom",
      message: "Plugin action scope requires plugin and action display metadata.",
    })
  }
}).meta({
  ref: "PermissionScope",
}) as unknown as z.ZodType<Scope>

export const RequestStatus = z.enum(["pending", "approved", "denied", "expired"]).meta({
  ref: "PermissionRequestStatus",
})
export type RequestStatus = z.infer<typeof RequestStatus>

export const Risk = z.enum(["low", "medium", "high", "critical"]).meta({
  ref: "PermissionRisk",
})
export type Risk = z.infer<typeof Risk>

export const ToolKind = z.enum(["read", "write", "search", "exec", "workflow", "interaction", "delegation", "other"]).meta({
  ref: "PermissionToolKind",
})
export type ToolKind = z.infer<typeof ToolKind>

export const RequestResource = z
  .object({
    paths: z.array(z.string()).optional(),
    command: z.string().optional(),
    workdir: z.string().optional(),
    body: z.string().optional(),
  })
  .meta({
    ref: "PermissionRequestResource",
  })
export type RequestResource = z.infer<typeof RequestResource>

export const RequestPrompt = z
  .object({
    title: z.string(),
    summary: z.string(),
    rationale: z.string(),
    risk: Risk,
    detailsAvailable: z.boolean(),
    details: RequestResource.optional(),
    allowedDecisions: z.array(Decision),
    recommendedDecision: Decision,
  })
  .meta({
    ref: "PermissionRequestPrompt",
  })
export type RequestPrompt = z.infer<typeof RequestPrompt>

export const RequestRuntime = z
  .object({
    tool: z.string(),
    toolKind: ToolKind.optional(),
    input: z.record(z.string(), z.any()),
    resource: RequestResource.optional(),
  })
  .meta({
    ref: "PermissionRequestRuntime",
  })
export type RequestRuntime = z.infer<typeof RequestRuntime>

export const RequestResolutionRecord = z
  .object({
    decision: Decision,
    note: z.string().optional(),
    approved: z.boolean(),
    resolvedAt: z.number(),
  })
  .meta({
    ref: "PermissionRequestResolutionRecord",
  })
export type RequestResolutionRecord = z.infer<typeof RequestResolutionRecord>

export const Request = z
  .object({
    id: Identifier.schema("permission"),
    approvalID: z.string(),
    sessionID: Identifier.schema("session"),
    messageID: Identifier.schema("message"),
    toolCallID: z.string(),
    projectID: z.string(),
    agent: z.string(),
    tool: z.string(),
    toolKind: ToolKind.optional(),
    title: z.string().optional(),
    risk: Risk,
    status: RequestStatus,
    turnID: Identifier.schema("turn").optional(),
    continuation: Continuation.optional(),
    scope: Scope.optional(),
    grantID: z.string().trim().min(1).max(256).optional(),
    input: z.record(z.string(), z.any()),
    resource: RequestResource.optional(),
    prompt: RequestPrompt.optional(),
    runtime: RequestRuntime.optional(),
    createdAt: z.number(),
    resolvedAt: z.number().optional(),
    resolutionReason: z.string().optional(),
    resolution: RequestResolutionRecord.optional(),
  })
  .meta({
    ref: "PermissionRequest",
  })
export type Request = z.infer<typeof Request>

export const RequestResolution = z
  .object({
    decision: Decision,
    note: z.string().optional(),
  })
  .meta({
    ref: "PermissionRequestResolution",
  })
export type RequestResolution = z.infer<typeof RequestResolution>

export const RequestPromptView = z
  .object({
    id: Identifier.schema("permission"),
    approvalID: z.string(),
    sessionID: Identifier.schema("session"),
    messageID: Identifier.schema("message"),
    toolCallID: z.string(),
    projectID: z.string(),
    agent: z.string(),
    status: RequestStatus,
    createdAt: z.number(),
    turnID: Identifier.schema("turn").optional(),
    continuation: Continuation,
    scope: Scope.optional(),
    grantID: z.string().trim().min(1).max(256).optional(),
    prompt: RequestPrompt,
    resolution: RequestResolutionRecord.optional(),
  })
  .meta({
    ref: "PermissionRequestPromptView",
  })
export type RequestPromptView = z.infer<typeof RequestPromptView>

export const Audit = z
  .object({
    id: Identifier.schema("permission"),
    sessionID: Identifier.schema("session"),
    messageID: Identifier.schema("message"),
    toolCallID: z.string().optional(),
    projectID: z.string().optional(),
    tool: z.string(),
    action: Action,
    reason: z.string(),
    risk: Risk,
    inputSummary: z.string().optional(),
    createdAt: z.number(),
  })
  .meta({
    ref: "PermissionAudit",
  })
export type Audit = z.infer<typeof Audit>
