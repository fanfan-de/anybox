import * as path from "node:path"
import z from "zod"
import * as Log from "#util/log.ts"
import * as db from "#database/Sqlite.ts"
import * as Identifier from "#id/id.ts"
import { Flag } from "#flag/flag.ts"
import { Instance } from "#project/instance.ts"
import * as Config from "#config/config.ts"
import * as Filesystem from "#util/filesystem.ts"
import * as Tool from "#tool/tool.ts"
import * as ToolRegistry from "#tool/registry.ts"
import * as Agent from "#agent/agent.ts"
import * as Message from "#session/core/message.ts"
import * as Orchestrator from "#session/runtime/orchestrator.ts"
import * as EventStore from "#session/runtime/event-store.ts"
import * as Session from "#session/core/session.ts"
import * as Schema from "#permission/schema.ts"

const log = Log.create({ service: "permission" })
let permissionTablesGeneration = -1

function ensurePermissionTables() {
  const generation = db.getDatabaseGeneration()
  if (permissionTablesGeneration === generation && generation > 0) return
  if (!db.tableExists("permission_requests")) {
    db.createTableByZodObject("permission_requests", Schema.Request)
  }
  db.syncTableColumnsWithZodObject("permission_requests", Schema.Request)
  if (!db.tableExists("permission_audits")) {
    db.createTableByZodObject("permission_audits", Schema.Audit)
  }
  permissionTablesGeneration = db.getDatabaseGeneration()
}

export {
  Action,
  Audit,
  Continuation,
  Decision,
  Request,
  RequestPrompt,
  RequestPromptView,
  RequestResolution,
  RequestResolutionRecord,
  RequestStatus,
  RequestResource,
  Risk,
  Scope,
  ToolKind,
} from "#permission/schema.ts"

type Request = Schema.Request
type Risk = Schema.Risk
type Action = Schema.Action
type Decision = Schema.Decision

export type InProcessPermissionInput = {
  context: {
    sessionID: string
    turnID: string
    messageID: string
    toolCallID: string
  }
  scope: Schema.Scope
  grantID?: string
  method: string
  tabID?: number
  tabTitle?: string
  risk?: Risk
  sensitive?: boolean
  action?: "allow" | "ask" | "deny"
  rationale?: string
  timeoutMs?: number
}

export type InProcessPermissionResult = {
  decision: Decision
  grantID: string
}

type InProcessWaiter = {
  resolve: (result: InProcessPermissionResult) => void
  timer: ReturnType<typeof setTimeout>
}

const inProcessWaiters = new Map<string, InProcessWaiter>()
const sessionInProcessGrants = new Map<string, {
  grantID: string
  sessionID: string
  scope: Schema.Scope
  createdAt: number
}>()

function resolvedInProcessDecision(request: Request): Decision {
  if (request.status !== "approved") return "deny"
  return request.resolution?.decision === "allow-session"
    ? "allow-session"
    : "allow-once"
}

function settleInProcessWaiter(
  request: Request,
  decision = resolvedInProcessDecision(request),
) {
  const waiter = inProcessWaiters.get(request.id)
  if (!waiter) return false
  clearTimeout(waiter.timer)
  inProcessWaiters.delete(request.id)
  waiter.resolve({
    decision,
    grantID: request.grantID ?? request.approvalID,
  })
  return true
}

type ToolDescriptor = {
  id: string
  kind: Tool.ToolKind
  readOnly: boolean
  destructive: boolean
  needsShell: boolean
}

export type EvaluationInput = {
  sessionID: string
  turnID?: string
  messageID: string
  toolCallID?: string
  projectID: string
  agent: string
  cwd?: string
  worktree?: string
  tool: ToolDescriptor
  input: Record<string, unknown>
  intent?: Tool.ToolPermissionIntent
}

export type EvaluationResult = {
  action: Action
  reason: string
  risk: Risk
  derived: {
    paths: string[]
    command?: string
    workdir?: string
    body?: string
  }
}

type RequestFilters = {
  status?: Schema.RequestStatus
  sessionID?: string
}

const DEFAULT_ACTIONS: Record<Tool.ToolKind, Schema.Action> = {
  read: "allow",
  search: "allow",
  interaction: "allow",
  write: "allow",
  exec: "allow",
  workflow: "allow",
  delegation: "allow",
  other: "allow",
}

const SENSITIVE_PATH_PATTERNS = [
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  ".git/**",
  "node_modules/**",
]

function normalizeToolName(toolID: string) {
  return toolID.trim().toLowerCase().replaceAll("_", "").replaceAll("-", "")
}

function isExitPlanModeTool(toolID: string) {
  return normalizeToolName(toolID) === "exitplanmode"
}

function asPosix(value: string) {
  return value.replaceAll("\\", "/")
}

function wildcardToRegex(pattern: string) {
  const normalized = asPosix(pattern)
  let regex = "^"

  for (let index = 0; index < normalized.length; index++) {
    const char = normalized[index]!
    const next = normalized[index + 1]

    if (char === "*" && next === "*") {
      regex += ".*"
      index += 1
      continue
    }

    if (char === "*") {
      regex += "[^/]*"
      continue
    }

    regex += /[|\\{}()[\]^$+?.]/.test(char) ? `\\${char}` : char
  }

  return new RegExp(`${regex}$`, "i")
}

function matchPattern(pattern: string, value: string) {
  const normalizedValue = asPosix(value)
  if (pattern.startsWith("/") && pattern.endsWith("/") && pattern.length > 2) {
    return new RegExp(pattern.slice(1, -1), "i").test(normalizedValue)
  }

  if (pattern.includes("*")) {
    return wildcardToRegex(pattern).test(normalizedValue)
  }

  return asPosix(pattern).toLowerCase() === normalizedValue.toLowerCase()
}

function summarizeInput(input: Record<string, unknown>) {
  try {
    const serialized = JSON.stringify(input)
    if (!serialized) return undefined
    return serialized.length > 800 ? `${serialized.slice(0, 800)}...` : serialized
  } catch {
    return undefined
  }
}

function normalizeExecutionError(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  if (typeof error === "string") {
    return error
  }

  try {
    const serialized = JSON.stringify(error)
    if (serialized) return serialized
  } catch {
    // ignore and fall through to String(error)
  }

  return String(error)
}

function defaultActionForKind(kind: Tool.ToolKind) {
  return DEFAULT_ACTIONS[kind]
}

function buildAskPermissionReason(reason: string | undefined) {
  const original = reason?.trim()
  return original
    ? `Tool requires approval before it can continue. Original approval rationale: ${original}`
    : "Tool requires approval before it can continue."
}

function buildFullAccessReason(reason: string | undefined) {
  const original = reason?.trim()
  return original
    ? `Full access mode approved this approval-required tool call. Original approval rationale: ${original}`
    : "Full access mode approved this approval-required tool call."
}

function isPermissionDisabled() {
  const value = Flag.ANYBOX_PERMISSION?.trim().toLowerCase()
  return value === "off" || value === "false" || value === "0" || value === "disabled"
}

function extractPatchPaths(patch: string) {
  const matches = patch.matchAll(/^(?:---|\+\+\+)\s+(.*)$/gm)
  const result = new Set<string>()

  for (const match of matches) {
    const raw = match[1]?.trim()
    if (!raw || raw === "/dev/null") continue
    const normalized = raw.startsWith("a/") || raw.startsWith("b/") ? raw.slice(2) : raw
    result.add(normalized)
  }

  return [...result]
}

function resolvePathCandidate(inputPath: string, cwd: string, worktree?: string) {
  const resolved = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(cwd, inputPath)
  const normalized = Filesystem.normalizePath(resolved)

  const root = worktree || cwd
  const relative = asPosix(path.relative(root, normalized))
  const inside = Filesystem.contains(root, normalized) || Filesystem.contains(cwd, normalized)

  return {
    absolute: normalized,
    relative: relative && relative !== "" && !relative.startsWith("..") ? relative : asPosix(inputPath),
    inside,
  }
}

function collectPathInputs(input: Record<string, unknown>, intent?: Tool.ToolPermissionIntent) {
  const raw = new Set<string>()

  for (const key of ["path", "file_path", "workdir"]) {
    const value = input[key]
    if (typeof value === "string" && value.trim()) {
      raw.add(value.trim())
    }
  }

  const resourceWorkdir = intent?.resource?.workdir
  if (typeof resourceWorkdir === "string" && resourceWorkdir.trim()) {
    raw.add(resourceWorkdir.trim())
  }

  const valuePaths = input["paths"]
  if (Array.isArray(valuePaths)) {
    for (const item of valuePaths) {
      if (typeof item === "string" && item.trim()) raw.add(item.trim())
    }
  }

  const patch = input["patch"]
  if (typeof patch === "string" && patch.trim()) {
    for (const patchPath of extractPatchPaths(patch)) {
      raw.add(patchPath)
    }
  }

  for (const item of intent?.resource?.paths ?? []) {
    if (typeof item === "string" && item.trim()) raw.add(item.trim())
  }

  return raw
}

function extractPaths(input: Record<string, unknown>, cwd: string, worktree?: string, intent?: Tool.ToolPermissionIntent) {
  const raw = collectPathInputs(input, intent)
  const resolved = [...raw].map((value) => resolvePathCandidate(value, cwd, worktree))
  return {
    resolved,
    relativePaths: [...new Set(resolved.map((item) => item.relative))],
    hasOutsidePath: resolved.some((item) => !item.inside),
  }
}

function isSensitivePath(relativePath: string) {
  return SENSITIVE_PATH_PATTERNS.some((pattern) => matchPattern(pattern, relativePath))
}

const RISK_ORDER: Record<Risk, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
}

function maxRisk(left: Risk, right: Risk) {
  return RISK_ORDER[right] > RISK_ORDER[left] ? right : left
}

function deriveRisk(input: EvaluationInput, derivedPaths: string[]) {
  if (derivedPaths.some(isSensitivePath)) {
    if (input.tool.kind === "write" || input.tool.kind === "exec" || input.tool.destructive) {
      return "critical"
    }

    return "high"
  }
  if (input.tool.kind === "exec") return "high"
  if (input.tool.kind === "write") return input.tool.destructive ? "high" : "medium"
  if (input.tool.kind === "delegation") return input.tool.readOnly ? "low" : "medium"
  if (input.tool.kind === "workflow") return input.tool.destructive ? "medium" : "low"
  return "low"
}

function decisionToApproved(decision: Decision) {
  return decision !== "deny"
}

function inProcessGrantKey(scope: Schema.Scope) {
  if (scope.kind === "browser-origin") {
    return [scope.kind, scope.sessionID, scope.extensionInstanceID, scope.origin].join("\u0000")
  }
  return [scope.kind, scope.sessionID, scope.pluginID].join("\u0000")
}

function safeDisplayText(value: string | undefined, fallback: string, max = 200) {
  const normalized = value
    ?.replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return (normalized || fallback).slice(0, max)
}

async function auditInProcess(
  input: InProcessPermissionInput,
  action: Action,
  reason: string,
  risk: Risk,
  projectID: string,
) {
  ensurePermissionTables()
  const record = Schema.Audit.parse({
    id: Identifier.ascending("permission"),
    sessionID: input.context.sessionID,
    messageID: input.context.messageID,
    toolCallID: input.context.toolCallID,
    projectID,
    tool: input.scope.kind === "browser-origin"
      ? `browser.${safeDisplayText(input.method, "unknown", 128)}`
      : `plugin-action.${input.scope.pluginID}.${safeDisplayText(input.method, "unknown", 128)}`,
    action,
    reason,
    risk,
    inputSummary: JSON.stringify({
      method: safeDisplayText(input.method, "unknown", 128),
      ...(input.scope.kind === "browser-origin"
        ? { origin: input.scope.origin, tabID: input.tabID }
        : {
            pluginID: input.scope.pluginID,
            pluginDisplayName: input.scope.pluginDisplayName,
            actionTitle: input.scope.actionTitle,
          }),
      sensitive: input.sensitive === true,
    }),
    createdAt: Date.now(),
  })
  db.insertOneWithSchema("permission_audits", record, Schema.Audit)
}

function emitOrPersistPermissionEvent(
  type: "permission.requested" | "permission.resolved",
  request: Request,
  part: Message.PermissionPart,
) {
  const active = Orchestrator.activeTurn(request.sessionID, request.turnID)
  if (active && active.turnID === request.turnID) {
    active.emit(type, { request, part })
    return
  }
  EventStore.appendSessionEvent(request.sessionID, type, { request, part })
}

async function expireInProcessRequest(requestID: string) {
  const waiter = inProcessWaiters.get(requestID)
  if (!waiter) return
  inProcessWaiters.delete(requestID)
  let grantID = requestID
  try {
    const existing = await getRequest(requestID)
    grantID = existing?.grantID ?? existing?.approvalID ?? requestID
    if (!existing || existing.status !== "pending") return
    const now = Date.now()
    const next = Schema.Request.parse({
      ...existing,
      status: "expired",
      resolvedAt: now,
      resolutionReason: "The in-process permission request timed out.",
      resolution: {
        decision: "deny",
        approved: false,
        resolvedAt: now,
        note: "The in-process permission request timed out.",
      },
    })
    const part = createPermissionPart({
      sessionID: next.sessionID,
      messageID: next.messageID,
      approvalID: next.approvalID,
      toolCallID: next.toolCallID,
      tool: next.tool,
      action: "deny",
      reason: next.resolutionReason,
    })
    emitOrPersistPermissionEvent("permission.resolved", next, part)
    await auditInProcess({
      context: {
        sessionID: next.sessionID,
        turnID: next.turnID ?? "",
        messageID: next.messageID,
        toolCallID: next.toolCallID,
      },
      scope: next.scope!,
      grantID: next.grantID,
      method: next.input.method as string,
      tabID: typeof next.input.tabID === "number" ? next.input.tabID : undefined,
      sensitive: next.input.sensitive === true,
    }, "deny", next.resolutionReason!, next.risk, next.projectID)
  } catch (error) {
    log.error("failed to persist expired in-process permission", {
      requestID,
      error,
    })
  } finally {
    waiter.resolve({
      decision: "deny",
      grantID,
    })
  }
}

export async function clearInProcessPermissionSession(sessionID: string) {
  for (const [key, grant] of sessionInProcessGrants) {
    if (grant.sessionID === sessionID) sessionInProcessGrants.delete(key)
  }
  for (const [requestID, waiter] of inProcessWaiters) {
    const request = db.findById("permission_requests", Schema.Request, requestID)
    if (request?.sessionID !== sessionID) continue
    clearTimeout(waiter.timer)
    inProcessWaiters.delete(requestID)
    try {
      if (request.status !== "pending") continue
      const now = Date.now()
      const reason = "The in-process permission request was cancelled because the session ended."
      const next = Schema.Request.parse({
        ...request,
        status: "denied",
        resolvedAt: now,
        resolutionReason: reason,
        resolution: {
          decision: "deny",
          approved: false,
          resolvedAt: now,
          note: reason,
        },
      })
      const part = createPermissionPart({
        sessionID: next.sessionID,
        messageID: next.messageID,
        approvalID: next.approvalID,
        toolCallID: next.toolCallID,
        tool: next.tool,
        action: "deny",
        reason,
      })
      emitOrPersistPermissionEvent("permission.resolved", next, part)
      await auditInProcess({
        context: {
          sessionID: next.sessionID,
          turnID: next.turnID ?? "",
          messageID: next.messageID,
          toolCallID: next.toolCallID,
        },
        scope: next.scope!,
        grantID: next.grantID,
        method: typeof next.input.method === "string"
          ? next.input.method
          : next.tool,
        tabID: typeof next.input.tabID === "number"
          ? next.input.tabID
          : undefined,
        sensitive: next.input.sensitive === true,
      }, "deny", reason, next.risk, next.projectID)
    } catch (error) {
      log.error("failed to persist cancelled in-process permission", {
        requestID,
        error,
      })
    } finally {
      waiter.resolve({
        decision: "deny",
        grantID: request.grantID ?? request.approvalID,
      })
    }
  }
}

export async function requestInProcessPermission(
  rawInput: InProcessPermissionInput,
): Promise<InProcessPermissionResult> {
  ensurePermissionTables()
  const projectID = Instance.project.id
  const context = {
    sessionID: Identifier.schema("session").parse(rawInput.context.sessionID),
    turnID: Identifier.schema("turn").parse(rawInput.context.turnID),
    messageID: Identifier.schema("message").parse(rawInput.context.messageID),
    toolCallID: z.string().trim().min(1).max(256).parse(rawInput.context.toolCallID),
  }
  const scope = Schema.Scope.parse({
    ...rawInput.scope,
    sessionID: rawInput.context.sessionID,
  })
  const input: InProcessPermissionInput = {
    ...rawInput,
    context,
    scope,
    method: z.string().trim().min(1).max(128).parse(rawInput.method),
    tabID: rawInput.tabID === undefined
      ? undefined
      : z.number().int().positive().parse(rawInput.tabID),
    tabTitle: rawInput.tabTitle === undefined
      ? undefined
      : safeDisplayText(rawInput.tabTitle, "Untitled tab"),
    risk: rawInput.risk ?? "medium",
  }
  if (scope.sessionID !== context.sessionID) {
    throw new Error("Permission scope session does not match the active tool context.")
  }

  const grantID = safeDisplayText(
    input.grantID,
    Identifier.ascending("permission"),
    256,
  )
  const risk = Schema.Risk.parse(input.risk)
  const grant = sessionInProcessGrants.get(inProcessGrantKey(scope))
  const isPluginAction = scope.kind === "plugin-action"
  const forceSingle = input.sensitive === true || isPluginAction

  if (input.action === "deny") {
    const reason = input.rationale?.trim() || (
      isPluginAction
        ? "This plugin action is prohibited by policy."
        : "The browser action is prohibited by policy."
    )
    await auditInProcess(input, "deny", reason, risk, projectID)
    return { decision: "deny", grantID }
  }

  if (!forceSingle && grant) {
    const reason = "The browser origin is allowed for the current session."
    await auditInProcess(input, "allow", reason, risk, projectID)
    return { decision: "allow-session", grantID: grant.grantID }
  }

  const permissionMode = await Config.getPermissionMode(Config.GLOBAL_CONFIG_ID)
  if (
    !forceSingle
    && (input.action === "allow" || permissionMode.mode === "full_access")
  ) {
    const reason = input.action === "allow"
      ? "The browser action is allowed by the safe-read policy."
      : "The browser action is allowed by full access mode."
    await auditInProcess(input, "allow", reason, risk, projectID)
    return { decision: "allow-once", grantID }
  }

  const active = Orchestrator.activeTurn(context.sessionID, context.turnID)
  if (!active || active.turnID !== context.turnID) {
    throw new Error("The in-process permission request no longer belongs to an active turn.")
  }

  const method = safeDisplayText(
    input.method,
    isPluginAction ? "plugin action" : "browser action",
    128,
  )
  const origin = scope.kind === "browser-origin"
    ? safeDisplayText(scope.origin, "unknown origin", 2_048)
    : undefined
  const tabTitle = scope.kind === "browser-origin"
    ? safeDisplayText(input.tabTitle, "Untitled tab")
    : undefined
  const pluginDisplayName = scope.kind === "plugin-action"
    ? safeDisplayText(scope.pluginDisplayName, "Plugin")
    : undefined
  const rationale = safeDisplayText(
    input.rationale,
    forceSingle
      ? "This action may enter a sensitive value and always requires a one-time decision."
      : "This origin has not been authorized for the current session.",
    500,
  )
  const requestID = Identifier.ascending("permission")
  const prompt = buildPromptSnapshot({
    descriptor: {
      title: isPluginAction
        ? `${pluginDisplayName}: ${safeDisplayText(scope.actionTitle, method)}`
        : `Browser permission: ${method}`,
      summary: isPluginAction
        ? safeDisplayText(scope.actionSummary, `Run ${method}.`, 1_000)
        : `${method} on ${origin} in “${tabTitle}”.`,
      details: isPluginAction && scope.actionBody
        ? { body: scope.actionBody }
        : undefined,
    },
    rationale,
    risk,
    derived: {
      paths: [],
      workdir: undefined,
      command: undefined,
      body: isPluginAction ? scope.actionBody : undefined,
    },
    allowedDecisions: forceSingle
      ? ["deny", "allow-once"]
      : ["deny", "allow-once", "allow-session"],
    recommendedDecision: "allow-once",
  })
  const record = Schema.Request.parse({
    id: requestID,
    approvalID: grantID,
    sessionID: context.sessionID,
    turnID: context.turnID,
    messageID: context.messageID,
    toolCallID: context.toolCallID,
    projectID,
    agent: "default",
    tool: isPluginAction
      ? `plugin-action.${scope.pluginID}.${method}`
        : `browser.${method}`,
    toolKind: "interaction",
    title: prompt.title,
    risk,
    status: "pending",
    continuation: "in-process",
    scope,
    grantID,
    input: {
      method,
      ...(isPluginAction
        ? {
            pluginID: scope.pluginID,
            pluginDisplayName,
            actionTitle: scope.actionTitle,
          }
          : { origin, tabID: input.tabID, tabTitle }),
      sensitive: forceSingle,
    },
    prompt,
    runtime: {
      tool: isPluginAction
        ? `plugin-action.${scope.pluginID}.${method}`
          : `browser.${method}`,
      toolKind: "interaction",
      input: {
        method,
        ...(isPluginAction
          ? {
              pluginID: scope.pluginID,
              pluginDisplayName,
              actionTitle: scope.actionTitle,
            }
            : { origin, tabID: input.tabID }),
        sensitive: forceSingle,
      },
    },
    createdAt: Date.now(),
  })
  const part = createPermissionPart({
    sessionID: record.sessionID,
    messageID: record.messageID,
    approvalID: record.approvalID,
    toolCallID: record.toolCallID,
    tool: record.tool,
    action: "ask",
    reason: rationale,
  })
  const timeout = Math.min(
    Math.max(Math.trunc(input.timeoutMs ?? 120_000), 1_000),
    120_000,
  )
  const result = new Promise<InProcessPermissionResult>((resolve) => {
    const timer = setTimeout(() => {
      void expireInProcessRequest(requestID)
    }, timeout)
    inProcessWaiters.set(requestID, { resolve, timer })
  })
  try {
    emitOrPersistPermissionEvent("permission.requested", record, part)
    await auditInProcess(input, "ask", rationale, risk, projectID)
  } catch (error) {
    const waiter = inProcessWaiters.get(requestID)
    if (waiter) {
      clearTimeout(waiter.timer)
      inProcessWaiters.delete(requestID)
    }
    throw error
  }
  return await result
}

function summarizeDerivedTarget(derived: EvaluationResult["derived"]) {
  if (derived.command) return `Run ${derived.command}`
  if (derived.body) return "the proposed implementation plan"
  if (derived.paths.length === 1) return derived.paths[0]!
  if (derived.paths.length > 1) return `${derived.paths.length} project paths`
  return "project resources"
}

function buildFallbackApprovalDescriptor(input: {
  tool: string
  title?: string
  derived: EvaluationResult["derived"]
}): Tool.ToolApprovalDescriptor {
  const title = input.title?.trim() || input.tool
  return {
    title,
    summary: `${title} will access ${summarizeDerivedTarget(input.derived)}.`,
    details: {
      command: input.derived.command,
      paths: input.derived.paths.length > 0 ? input.derived.paths : undefined,
      workdir: input.derived.workdir,
      body: input.derived.body,
    },
  }
}

function buildPromptSnapshot(input: {
  descriptor: Tool.ToolApprovalDescriptor
  rationale: string
  risk: Risk
  derived: EvaluationResult["derived"]
  allowedDecisions: Decision[]
  recommendedDecision?: Decision
}): Schema.RequestPrompt {
  const details = input.descriptor.details ?? {
    command: input.derived.command,
    paths: input.derived.paths.length > 0 ? input.derived.paths : undefined,
    workdir: input.derived.workdir,
    body: input.derived.body,
  }

  const hasDetails = Boolean(
    details.command ||
    details.workdir ||
    details.body ||
    (details.paths?.length ?? 0) > 0,
  )
  const recommended = input.allowedDecisions.includes(input.recommendedDecision ?? "allow")
    ? (input.recommendedDecision ?? "allow")
    : (input.allowedDecisions.find((decision) => decision !== "deny") ?? "deny")

  return Schema.RequestPrompt.parse({
    title: input.descriptor.title?.trim() || "Permission request",
    summary: input.descriptor.summary.trim(),
    rationale: input.rationale.trim(),
    risk: input.risk,
    detailsAvailable: hasDetails,
    details: hasDetails ? details : undefined,
    allowedDecisions: input.allowedDecisions,
    recommendedDecision: recommended,
  })
}

function buildRuntimeSnapshot(input: {
  tool: string
  toolKind?: Schema.ToolKind
  rawInput: Record<string, unknown>
  derived: EvaluationResult["derived"]
}): Schema.RequestRuntime {
  return Schema.RequestRuntime.parse({
    tool: input.tool,
    toolKind: input.toolKind,
    input: input.rawInput,
    resource: {
      paths: input.derived.paths.length > 0 ? input.derived.paths : undefined,
      command: input.derived.command,
      workdir: input.derived.workdir,
      body: input.derived.body,
    },
  })
}

function extractRequestBody(request: Pick<Request, "prompt" | "resource" | "runtime">) {
  const body =
    request.prompt?.details?.body ??
    request.runtime?.resource?.body ??
    request.resource?.body

  return typeof body === "string" && body.trim().length > 0
    ? body.trim()
    : undefined
}

function updatePlanWorkflowForPendingRequest(request: Request) {
  if (!isExitPlanModeTool(request.tool)) return

  const draftMarkdown = extractRequestBody(request)
  Session.updateSessionWorkflow(request.sessionID, (workflow) => ({
    mode: "planning",
    plan: {
      status: "pending-approval",
      draftMarkdown: draftMarkdown ?? workflow.plan.draftMarkdown,
      pendingRequestID: request.id,
      approvedMarkdown: undefined,
      updatedAt: Date.now(),
    },
  }))
}

function updatePlanWorkflowForDeniedRequest(request: Request) {
  if (!isExitPlanModeTool(request.tool)) return

  const draftMarkdown = extractRequestBody(request)
  Session.updateSessionWorkflow(request.sessionID, (workflow) => ({
    mode: "planning",
    plan: {
      status: "draft",
      draftMarkdown: draftMarkdown ?? workflow.plan.draftMarkdown,
      pendingRequestID: undefined,
      approvedMarkdown: workflow.plan.approvedMarkdown,
      approvedAt: workflow.plan.approvedAt,
      updatedAt: Date.now(),
    },
  }))
}

async function findStoredRequestForToolCall(toolCallID: string | undefined) {
  if (!toolCallID) return undefined

  return db
    .findManyWithSchema("permission_requests", Schema.Request, {
      where: [{ column: "toolCallID", value: toolCallID }],
      orderBy: [{ column: "createdAt", direction: "DESC" }],
      limit: 1,
    })[0]
}

async function audit(input: EvaluationInput, decision: EvaluationResult) {
  ensurePermissionTables()
  const record = Schema.Audit.parse({
    id: Identifier.ascending("permission"),
    sessionID: input.sessionID,
    messageID: input.messageID,
    toolCallID: input.toolCallID,
    projectID: input.projectID,
    tool: input.tool.id,
    action: decision.action,
    reason: decision.reason,
    risk: decision.risk,
    inputSummary: summarizeInput(input.input),
    createdAt: Date.now(),
  })

  db.insertOneWithSchema("permission_audits", record, Schema.Audit)
}

export async function evaluate(input: EvaluationInput): Promise<EvaluationResult> {
  ensurePermissionTables()
  const intent = input.intent
  const command =
    typeof intent?.resource?.command === "string" && intent.resource.command.trim()
      ? intent.resource.command.trim()
      : typeof input.input.command === "string"
        ? input.input.command.trim()
        : undefined
  const body =
    typeof intent?.resource?.body === "string" && intent.resource.body.trim()
      ? intent.resource.body.trim()
      : typeof input.input.body === "string"
        ? input.input.body.trim()
        : undefined
  const cwd = input.cwd ?? Instance.directory
  const worktree = input.worktree ?? Instance.worktree
  const session = Session.DataBaseRead("sessions", input.sessionID) as Session.SessionInfo | null
  const derivedPaths = extractPaths(input.input, cwd, worktree, intent)
  const derived = {
    paths: derivedPaths.relativePaths,
    command,
    workdir: intent?.resource?.workdir || cwd,
    body: body || undefined,
  }
  const workflow = Session.normalizeWorkflowState(session?.workflow)
  const risk = maxRisk(deriveRisk(input, derived.paths), intent?.risk ?? "low")
  const turn = input.turnID
    ? Session.DataBaseRead("turns", input.turnID) as Session.TurnInfo | null
    : null

  if (
    (turn?.threadTargetKind === "detached-branch" || session?.policy?.toolPolicy === "read-only") &&
    input.tool.readOnly !== true
  ) {
    const result: EvaluationResult = {
      action: "deny",
      reason:
        turn?.threadTargetKind === "detached-branch"
          ? "Branch Chat is read-only and blocks tools with side effects."
          : "This session is read-only and blocks tools with side effects.",
      risk: risk === "low" ? "medium" : risk,
      derived,
    }
    await audit(input, result)
    return result
  }

  if (isPermissionDisabled()) {
    const result: EvaluationResult = {
      action: "allow",
      reason: "Permission checks are disabled by ANYBOX_PERMISSION.",
      risk,
      derived,
    }
    await audit(input, result)
    return result
  }

  if (derivedPaths.hasOutsidePath && input.tool.readOnly !== true) {
    const result: EvaluationResult = {
      action: "deny",
      reason: "Tool input referenced a path outside the active project boundary for a tool with side effects.",
      risk: "critical",
      derived,
    }
    await audit(input, result)
    return result
  }

  const storedRequest = await findStoredRequestForToolCall(input.toolCallID)
  if (storedRequest?.status === "approved") {
    const result: EvaluationResult = {
      action: "allow",
      reason: "Tool execution was approved by the user.",
      risk: storedRequest.risk,
      derived,
    }
    await audit(input, result)
    return result
  }

  if (storedRequest?.status === "denied") {
    const result: EvaluationResult = {
      action: "deny",
      reason: storedRequest.resolutionReason?.trim() || "Tool execution was denied by the user.",
      risk: storedRequest.risk,
      derived,
    }
    await audit(input, result)
    return result
  }

  if (workflow.mode === "planning" && input.tool.readOnly !== true && intent?.allowInPlanning !== true) {
    const result: EvaluationResult = {
      action: "deny",
      reason: "Planning mode blocks tools with side effects until the submitted plan is approved.",
      risk: risk === "critical" ? "critical" : "high",
      derived,
    }
    await audit(input, result)
    return result
  }

  if (intent?.action === "deny") {
    const result: EvaluationResult = {
      action: "deny",
      reason: intent.reason?.trim() || "The tool denied this operation.",
      risk,
      derived,
    }
    await audit(input, result)
    return result
  }

  if (risk === "critical") {
    const result: EvaluationResult = {
      action: "deny",
      reason: "Critical-risk tool calls are blocked by the automatic safe-run policy.",
      risk,
      derived,
    }
    await audit(input, result)
    return result
  }

  if (intent?.action === "ask") {
    const permissionMode = await Config.getPermissionMode(Config.GLOBAL_CONFIG_ID)
    const action: Action = permissionMode.mode === "full_access" && intent.forceAsk !== true ? "allow" : "ask"
    const result: EvaluationResult = {
      action,
      reason: action === "allow"
        ? buildFullAccessReason(intent.reason)
        : buildAskPermissionReason(intent.reason),
      risk,
      derived,
    }
    await audit(input, result)
    return result
  }

  if (intent?.action === "allow") {
    const result: EvaluationResult = {
      action: "allow",
      reason: intent.reason?.trim() || "The tool allows this operation without approval.",
      risk,
      derived,
    }
    await audit(input, result)
    return result
  }

  const fallback = defaultActionForKind(input.tool.kind)
  const result: EvaluationResult = {
    action: fallback,
    reason:
      fallback === "allow"
        ? "This tool is auto-run by the default safe-run policy."
        : "This tool is denied by the default safe-run policy because it lacks a safe automatic classifier.",
    risk,
    derived,
  }

  await audit(input, result)
  return result
}

export async function listRequests(filters: RequestFilters = {}) {
  ensurePermissionTables()
  const where: { column: string; value: string }[] = []
  if (filters.status) where.push({ column: "status", value: filters.status })
  if (filters.sessionID) where.push({ column: "sessionID", value: filters.sessionID })
  return db.findManyWithSchema("permission_requests", Schema.Request, {
    where,
    orderBy: [{ column: "createdAt", direction: "DESC" }],
  })
}

export async function listRequestPrompts(filters: RequestFilters = {}) {
  const requests = await listRequests(filters)
  return requests.map((request) => toRequestPromptView(request))
}

export async function getRequest(id: string) {
  ensurePermissionTables()
  return db.findById("permission_requests", Schema.Request, id)
}

export async function getRequestPrompt(id: string) {
  const request = await getRequest(id)
  return request ? toRequestPromptView(request) : undefined
}

async function toolDescriptorForName(toolName: string): Promise<ToolDescriptor> {
  const toolInfo = await ToolRegistry.get(toolName)
  return {
    id: toolName,
    kind: toolInfo?.capabilities?.kind ?? "other",
    readOnly: toolInfo?.capabilities?.readOnly ?? false,
    destructive: toolInfo?.capabilities?.destructive ?? false,
    needsShell: toolInfo?.capabilities?.needsShell ?? false,
  }
}

function createPermissionPart(input: {
  sessionID: string
  messageID: string
  approvalID: string
  toolCallID: string
  tool: string
  action: Action
  reason?: string
}) {
  return Message.PermissionPart.parse({
    id: Identifier.ascending("part"),
    sessionID: input.sessionID,
    messageID: input.messageID,
    type: "permission",
    approvalID: input.approvalID,
    toolCallID: input.toolCallID,
    tool: input.tool,
    action: input.action,
    reason: input.reason,
    created: Date.now(),
  })
}

function assistantModelRef(assistant: Message.Assistant) {
  return {
    providerID: assistant.providerID,
    modelID: assistant.modelID,
  }
}

function readAssistantMessage(messageID: string) {
  const message = db.findById("messages", Message.MessageInfo, messageID)
  if (!message || message.role !== "assistant") return undefined
  return message
}

function openPermissionTurn(input: {
  sessionID: string
  sourceTurnID?: string
  agent?: string
  model?: {
    providerID: string
    modelID: string
  }
  userMessageID?: string
  turn?: Orchestrator.TurnContext
}) {
  const active = input.turn
  if (active) {
    return {
      turn: active,
      managed: false,
    }
  }

  const sourceTurn = input.sourceTurnID
    ? Session.DataBaseRead("turns", input.sourceTurnID) as Session.TurnInfo | null
    : null
  return {
    turn: Orchestrator.startTurn({
      sessionID: input.sessionID,
      executionID: sourceTurn?.executionID,
      targetKind: sourceTurn?.threadTargetKind,
      initialParentMessageID: sourceTurn?.initialParentMessageID,
      userMessageID: input.userMessageID,
      agent: input.agent,
      model: input.model,
    }),
    managed: true,
  }
}

function finishManagedTurn(
  handle: ReturnType<typeof openPermissionTurn>,
  payload: {
    status: "completed" | "blocked" | "stopped"
    finishReason?: string
    message?: Message.MessageInfo
    parts?: Message.Part[]
  },
) {
  if (!handle.managed) return
  handle.turn.emit("turn.completed", payload)
}

function failManagedTurn(
  handle: ReturnType<typeof openPermissionTurn>,
  error: unknown,
  message?: Message.MessageInfo,
  parts?: Message.Part[],
) {
  if (!handle.managed) return
  handle.turn.emit("turn.failed", {
    error: normalizeExecutionError(error),
    message,
    parts,
  })
}

export async function registerApprovalRequest(input: {
  assistant: Message.Assistant
  toolPart: Message.ToolPart
  turn?: Orchestrator.TurnContext
}) {
  ensurePermissionTables()
  if (input.toolPart.state.status !== "waiting-approval") {
    throw new Error("Tool part must be in waiting-approval state before creating an approval request.")
  }

  const descriptor = await toolDescriptorForName(input.toolPart.tool)
  const toolInfo = await ToolRegistry.get(input.toolPart.tool)
  const agentInfo = (await Agent.get(input.assistant.agent)) ?? Agent.planAgent
  const runtime = toolInfo ? await toolInfo.init({ agent: agentInfo }) : undefined
  const runtimeContext: Tool.Context = {
    sessionID: input.assistant.sessionID,
    turnID: input.turn?.turnID
      ?? Orchestrator.activeTurn(input.assistant.sessionID, input.assistant.turnID)?.turnID
      ?? input.toolPart.state.approvalID,
    messageID: input.assistant.id,
    cwd: input.assistant.path.cwd,
    worktree: input.assistant.path.root,
    toolCallID: input.toolPart.callID,
  }
  let intent: Tool.ToolPermissionIntent | undefined
  if (runtime?.assessPermission) {
    try {
      intent = await runtime.assessPermission(input.toolPart.state.input, runtimeContext)
    } catch (error) {
      log.warn("tool-specific permission assessment failed", {
        tool: input.toolPart.tool,
        error: normalizeExecutionError(error),
      })
    }
  }

  const decision = await evaluate({
    sessionID: input.assistant.sessionID,
    turnID: runtimeContext.turnID,
    messageID: input.assistant.id,
    toolCallID: input.toolPart.callID,
    projectID: Instance.project.id,
    agent: input.assistant.agent,
    cwd: input.assistant.path.cwd,
    worktree: input.assistant.path.root,
    tool: descriptor,
    input: input.toolPart.state.input,
    intent,
  })

  let approvalDescriptor: Tool.ToolApprovalDescriptor | undefined
  if (runtime?.describeApproval) {
    try {
      approvalDescriptor = await runtime.describeApproval(input.toolPart.state.input, runtimeContext)
    } catch (error) {
      log.warn("tool-specific approval description failed", {
        tool: input.toolPart.tool,
        error: normalizeExecutionError(error),
      })
    }
  }

  const prompt = buildPromptSnapshot({
    descriptor: approvalDescriptor ?? buildFallbackApprovalDescriptor({
      tool: input.toolPart.tool,
      title: input.toolPart.state.title,
      derived: decision.derived,
    }),
    rationale: decision.reason,
    risk: decision.risk,
    derived: decision.derived,
    allowedDecisions: ["deny", "allow"],
    recommendedDecision: "allow",
  })
  const runtimeSnapshot = buildRuntimeSnapshot({
    tool: input.toolPart.tool,
    toolKind: descriptor.kind,
    rawInput: input.toolPart.state.input,
    derived: decision.derived,
  })

  const record = Schema.Request.parse({
    id: Identifier.ascending("permission"),
    approvalID: input.toolPart.state.approvalID,
    sessionID: input.assistant.sessionID,
    messageID: input.assistant.id,
    toolCallID: input.toolPart.callID,
    projectID: Instance.project.id,
    agent: input.assistant.agent,
    tool: input.toolPart.tool,
    toolKind: descriptor.kind,
    title: input.toolPart.state.title,
    risk: decision.risk,
    status: "pending",
    turnID: input.turn?.turnID
      ?? Orchestrator.activeTurn(input.assistant.sessionID, input.assistant.turnID)?.turnID,
    continuation: "tool-retry",
    input: input.toolPart.state.input,
    resource: {
      paths: decision.derived.paths.length > 0 ? decision.derived.paths : undefined,
      command: decision.derived.command,
      workdir: decision.derived.workdir,
      body: runtimeSnapshot.resource?.body ?? extractRequestBody({ prompt, runtime: runtimeSnapshot }),
    },
    prompt,
    runtime: runtimeSnapshot,
    createdAt: Date.now(),
  })

  const part = createPermissionPart({
    sessionID: record.sessionID,
    messageID: record.messageID,
    approvalID: record.approvalID,
    toolCallID: record.toolCallID,
    tool: record.tool,
    action: "ask",
    reason: decision.reason,
  })

  updatePlanWorkflowForPendingRequest(record)

  const handle = openPermissionTurn({
    sessionID: record.sessionID,
    sourceTurnID: record.turnID,
    userMessageID: input.assistant.parentID || undefined,
    agent: input.assistant.agent,
    model: assistantModelRef(input.assistant),
    turn: input.turn,
  })

  try {
    if (handle.managed) {
      handle.turn.emit("tool.call.waiting_approval", {
        part: input.toolPart,
      })
    }

    handle.turn.emit("permission.requested", {
      request: record,
      part,
    })

    finishManagedTurn(handle, {
      status: "blocked",
      finishReason: "tool-approval",
      message: input.assistant,
      parts: [input.toolPart, part],
    })

    return record
  } catch (error) {
    failManagedTurn(handle, error, input.assistant, [input.toolPart, part])
    throw error
  } finally {
    if (handle.managed) {
      Orchestrator.finishTurn(handle.turn)
    }
  }
}

function ensureRequestResolutionRecord(request: Request): Schema.RequestResolutionRecord | undefined {
  if (request.resolution) return request.resolution
  if (!request.resolvedAt) return undefined

  const decision: Decision = request.status === "approved" ? "allow" : "deny"
  return Schema.RequestResolutionRecord.parse({
    decision,
    note: request.resolutionReason,
    approved: decisionToApproved(decision),
    resolvedAt: request.resolvedAt,
  })
}

function ensureRequestPrompt(request: Request): Schema.RequestPrompt {
  if (request.prompt) return request.prompt

  const derived = {
    paths: request.runtime?.resource?.paths ?? request.resource?.paths ?? [],
    command: request.runtime?.resource?.command ?? request.resource?.command,
    workdir: request.runtime?.resource?.workdir ?? request.resource?.workdir,
    body: request.runtime?.resource?.body ?? request.resource?.body,
  }

  return buildPromptSnapshot({
    descriptor: buildFallbackApprovalDescriptor({
      tool: request.runtime?.tool ?? request.tool,
      title: request.title,
      derived,
    }),
    rationale: "This tool requires approval before it can continue.",
    risk: request.risk,
    derived,
    allowedDecisions: ["deny", "allow"],
    recommendedDecision: "allow",
  })
}

function toRequestPromptView(request: Request): Schema.RequestPromptView {
  return Schema.RequestPromptView.parse({
    id: request.id,
    approvalID: request.approvalID,
    sessionID: request.sessionID,
    messageID: request.messageID,
    toolCallID: request.toolCallID,
    projectID: request.projectID,
    agent: request.agent,
    status: request.status,
    createdAt: request.createdAt,
    turnID: request.turnID,
    continuation: request.continuation ?? "tool-retry",
    scope: request.scope,
    grantID: request.grantID,
    prompt: ensureRequestPrompt(request),
    resolution: ensureRequestResolutionRecord(request),
  })
}

function findToolPart(sessionID: string, toolCallID: string) {
  ensurePermissionTables()
  const parts = db.findManyWithSchema("parts", Message.Part, {
    where: [{ column: "sessionID", value: sessionID }],
    orderBy: [{ column: "id", direction: "ASC" }],
  })

  return parts.find(
    (part): part is Message.ToolPart => part.type === "tool" && part.callID === toolCallID,
  )
}

function toAttachmentPart(
  value: Tool.ToolAttachment | undefined,
  toolPart: Message.ToolPart,
): Message.FilePart | undefined {
  if (!value) return undefined

  return Message.FilePart.parse({
    id: Identifier.ascending("part"),
    sessionID: toolPart.sessionID,
    messageID: toolPart.messageID,
    type: "file",
    url: value.url,
    mime: value.mime,
    filename: value.filename,
  })
}

async function completeApprovedRequest(
  request: Request,
  turn?: Orchestrator.TurnContext,
) {
  const session = Session.DataBaseRead("sessions", request.sessionID) as Session.SessionInfo | null
  if (!session) {
    throw new Error(`Session '${request.sessionID}' not found.`)
  }

  return Instance.provide({
    directory: session.directory,
    fn: async () => {
      const existing = findToolPart(request.sessionID, request.toolCallID)
      if (!existing || existing.state.status !== "waiting-approval") {
        throw new Error(`Waiting approval tool call '${request.toolCallID}' was not found.`)
      }

      const toolInfo = await ToolRegistry.get(request.tool)
      if (!toolInfo) {
        throw new Error(`Tool '${request.tool}' is not registered.`)
      }
      const sourceTurn = request.turnID
        ? Session.DataBaseRead("turns", request.turnID) as Session.TurnInfo | null
        : null
      if (
        sourceTurn?.threadTargetKind === "detached-branch" &&
        toolInfo.capabilities?.readOnly !== true
      ) {
        throw new Error("Branch Chat is read-only and blocks tools with side effects.")
      }

      const agentInfo = (await Agent.get(request.agent)) ?? Agent.planAgent
      const runtime = await toolInfo.init({ agent: agentInfo })
      const startedAt = existing.state.time.start
      const runningTitle = existing.state.title
      const running = Message.ToolPart.parse({
        ...existing,
        state: {
          status: "running",
          input: existing.state.input,
          raw: existing.state.raw,
          title: existing.state.title,
          metadata: existing.state.metadata,
          time: {
            start: startedAt,
          },
        },
      })

      if (turn) {
        turn.emit("tool.call.started", {
          part: running,
        })
      } else {
        await Session.updatePart(running)
      }

      try {
        const output = Tool.normalizeToolOutput(
          await runtime.execute(request.input, {
            sessionID: request.sessionID,
            turnID: turn?.turnID ?? request.approvalID,
            messageID: request.messageID,
            cwd: session.directory,
            worktree: Instance.worktree,
            abort: new AbortController().signal,
            toolCallID: request.toolCallID,
          }),
        )

        const attachments = (output.attachments ?? [])
          .map((attachment) => toAttachmentPart(attachment, existing))
          .filter((attachment): attachment is Message.FilePart => Boolean(attachment))

        const completed = Message.ToolPart.parse({
          ...running,
          state: {
            status: "completed",
            input: running.state.input,
            raw: running.state.raw,
            output: output.text,
            title: output.title ?? runningTitle ?? running.tool,
            metadata: output.metadata ?? {},
            time: {
              start: startedAt,
              end: Date.now(),
            },
            attachments: attachments.length > 0 ? attachments : undefined,
          },
        })

        if (turn) {
          turn.emit("tool.call.completed", {
            part: completed,
          })
        } else {
          await Session.updatePart(completed)
        }
        return completed
      } catch (error) {
        const failed = Message.ToolPart.parse({
          ...running,
          state: {
            status: "error",
            input: running.state.input,
            raw: running.state.raw,
            error: normalizeExecutionError(error),
            metadata: {},
            time: {
              start: startedAt,
              end: Date.now(),
            },
          },
        })

        if (turn) {
          turn.emit("tool.call.failed", {
            part: failed,
          })
        } else {
          await Session.updatePart(failed)
        }
        return failed
      }
    },
  })
}

async function denyApprovedRequest(
  request: Request,
  turn?: Orchestrator.TurnContext,
) {
  const existing = findToolPart(request.sessionID, request.toolCallID)
  if (!existing || existing.state.status !== "waiting-approval") {
    throw new Error(`Waiting approval tool call '${request.toolCallID}' was not found.`)
  }

  const denied = Message.ToolPart.parse({
    ...existing,
    state: {
      status: "denied",
      approvalID: existing.state.approvalID,
      input: existing.state.input,
      reason: request.resolutionReason?.trim() || "Tool execution was denied by the user.",
      metadata: {},
      time: {
        start: existing.state.time.start,
        end: Date.now(),
      },
    },
  })

  if (turn) {
    turn.emit("tool.call.denied", {
      part: denied,
    })
  } else {
    await Session.updatePart(denied)
  }
  return denied
}

export async function resolveRequest(id: string, resolution: Schema.RequestResolution) {
  ensurePermissionTables()
  const existing = await getRequest(id)
  if (!existing) {
    throw new Error(`Permission request '${id}' was not found.`)
  }
  if (existing.status !== "pending") {
    if ((existing.continuation ?? "tool-retry") === "in-process") {
      settleInProcessWaiter(existing)
    }
    return {
      request: existing,
    }
  }

  const allowedDecisions = ensureRequestPrompt(existing).allowedDecisions
  if (!allowedDecisions.includes(resolution.decision)) {
    throw new Error(
      `Decision '${resolution.decision}' is not allowed for permission request '${id}'.`,
    )
  }

  const approved = decisionToApproved(resolution.decision)

  let next = Schema.Request.parse({
    ...existing,
    status: approved ? "approved" : "denied",
    resolvedAt: Date.now(),
    resolutionReason: resolution.note,
    resolution: {
      decision: resolution.decision,
      note: resolution.note,
      approved,
      resolvedAt: Date.now(),
    },
  })

  const part = createPermissionPart({
    sessionID: next.sessionID,
    messageID: next.messageID,
    approvalID: next.approvalID,
    toolCallID: next.toolCallID,
    tool: next.tool,
    action: approved ? "allow" : "deny",
    reason: resolution.note,
  })

  if ((existing.continuation ?? "tool-retry") === "in-process") {
    if (!inProcessWaiters.has(existing.id)) {
      throw new Error(
        `In-process permission request '${existing.id}' is no longer active.`,
      )
    }

    const continuationDecision: Decision = approved
      ? resolution.decision === "allow-session"
        ? "allow-session"
        : "allow-once"
      : "deny"

    await auditInProcess({
      context: {
        sessionID: next.sessionID,
        turnID: next.turnID ?? "",
        messageID: next.messageID,
        toolCallID: next.toolCallID,
      },
      scope: next.scope!,
      grantID: next.grantID,
      method: typeof next.input.method === "string" ? next.input.method : next.tool,
      tabID: typeof next.input.tabID === "number" ? next.input.tabID : undefined,
      sensitive: next.input.sensitive === true,
    }, approved ? "allow" : "deny", resolution.note?.trim() || (
      approved ? "The in-process action was approved by the user." : "The in-process action was denied by the user."
    ), next.risk, next.projectID)

    emitOrPersistPermissionEvent("permission.resolved", next, part)
    if (continuationDecision === "allow-session" && next.scope) {
      sessionInProcessGrants.set(inProcessGrantKey(next.scope), {
        grantID: next.grantID ?? next.approvalID,
        sessionID: next.scope.sessionID,
        scope: next.scope,
        createdAt: Date.now(),
      })
    }
    settleInProcessWaiter(next, continuationDecision)
    return {
      request: next,
    }
  }

  if (!approved) {
    updatePlanWorkflowForDeniedRequest(next)
  }

  const assistant = readAssistantMessage(next.messageID)
  const handle = openPermissionTurn({
    sessionID: next.sessionID,
    sourceTurnID: next.turnID,
    userMessageID: assistant?.parentID || undefined,
    agent: assistant?.agent ?? next.agent,
    model: assistant ? assistantModelRef(assistant) : undefined,
  })

  let latestToolPart: Message.ToolPart | undefined
  try {
    handle.turn.emit("permission.resolved", {
      request: next,
      part,
    })

    if (approved) {
      const waiting = findToolPart(next.sessionID, next.toolCallID)
      if (!waiting || waiting.state.status !== "waiting-approval") {
        throw new Error(`Waiting approval tool call '${next.toolCallID}' was not found.`)
      }

      handle.turn.emit("tool.call.approved", {
        part: waiting,
      })
      latestToolPart = await completeApprovedRequest(next, handle.turn)
    } else {
      latestToolPart = await denyApprovedRequest(next, handle.turn)
    }

    finishManagedTurn(handle, {
      status: "completed",
      finishReason: approved ? "approval-resolved" : "approval-denied",
      message: assistant,
      parts: latestToolPart ? [part, latestToolPart] : [part],
    })

    return {
      request: next,
    }
  } catch (error) {
    failManagedTurn(handle, error, assistant, latestToolPart ? [part, latestToolPart] : [part])
    throw error
  } finally {
    if (handle.managed) {
      Orchestrator.finishTurn(handle.turn)
    }
  }
}
