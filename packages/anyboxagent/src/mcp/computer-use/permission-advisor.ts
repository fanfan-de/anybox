import type * as Config from "#config/config.ts"
import type {
  McpToolDefinition,
} from "#mcp/client.ts"
import type * as Tool from "#tool/tool.ts"
import { isComputerUseServer } from "#mcp/builtin.ts"

const READ_ONLY_TOOLS = new Set([
  "computer_health_check",
  "list_apps",
  "list_windows",
  "get_window",
  "get_window_state",
])
const HARD_DENY_SAFETY = new Set([
  "auth_or_secret",
  "finance",
  "security_settings",
])
const ELEVATED_SAFETY = new Set([
  "submit_or_send",
  "delete",
  "upload",
  "install",
])
const ELEVATED_PURPOSE =
  /\b(delete|remove|erase|send|submit|publish|upload|install|purchase|pay)\b|删除|移除|发送|提交|发布|上传|安装|支付|购买/i

export function assessComputerUsePermission(input: {
  server: Config.McpServerSummary
  tool: McpToolDefinition
  args: Record<string, unknown>
  configuredPolicy?: Config.McpToolPolicyValue
}): Tool.ToolPermissionIntent | undefined {
  if (!isComputerUseServer(input.server)) return undefined
  return assessComputerUseOperation({
    operation: input.tool.name,
    args: input.args,
    configuredPolicy: input.configuredPolicy,
  })
}

export function assessComputerUseOperation(input: {
  operation: string
  args: Record<string, unknown>
  configuredPolicy?: Config.McpToolPolicyValue
}): Tool.ToolPermissionIntent {
  if (input.configuredPolicy === "disabled") {
    return {
      action: "deny",
      risk: "high",
      reason: "Computer Use is disabled for this tool by the user's MCP policy.",
    }
  }
  if (READ_ONLY_TOOLS.has(input.operation)) {
    return respectConfiguredPolicy({
      action: "allow",
      risk: "low",
      reason: "Read-only Computer Use discovery; application access remains broker-gated.",
    }, input.configuredPolicy)
  }

  const safety = typeof input.args.safety === "string"
    ? input.args.safety.trim().toLowerCase()
    : ""
  if (HARD_DENY_SAFETY.has(safety)) {
    return respectConfiguredPolicy({
      action: "deny",
      risk: "critical",
      reason:
        "Anybox Computer Use blocks authentication secrets, financial actions, and security-setting changes.",
    }, input.configuredPolicy)
  }
  const purpose = typeof input.args.purpose === "string"
    ? input.args.purpose.trim()
    : ""
  const elevated = ELEVATED_SAFETY.has(safety) || ELEVATED_PURPOSE.test(purpose)
  return respectConfiguredPolicy({
    action: "ask",
    risk: elevated ? "high" : "medium",
    forceAsk: true,
    reason: elevated
      ? "This Computer Use action may delete, send, upload, install, publish, or purchase and requires explicit approval."
      : "Desktop input requires explicit approval even when the application is always allowed.",
    resource: {
      body: approvalBody(input.operation, input.args),
    },
  }, input.configuredPolicy)
}

export function describeComputerUseApproval(input: {
  server: Config.McpServerSummary
  tool: McpToolDefinition
  args: Record<string, unknown>
}): Tool.ToolApprovalDescriptor | undefined {
  if (!isComputerUseServer(input.server) || READ_ONLY_TOOLS.has(input.tool.name)) {
    return undefined
  }
  return describeComputerUseOperation({
    operation: input.tool.name,
    title: input.tool.title,
    args: input.args,
  })
}

export function describeComputerUseOperation(input: {
  operation: string
  title?: string
  args: Record<string, unknown>
}): Tool.ToolApprovalDescriptor | undefined {
  if (READ_ONLY_TOOLS.has(input.operation)) return undefined
  const purpose = typeof input.args.purpose === "string"
    ? input.args.purpose.trim()
    : ""
  return {
    title: input.title ?? input.operation,
    summary: purpose || `Run ${input.operation} through Computer Use.`,
    details: {
      body: approvalBody(input.operation, input.args),
    },
  }
}

function approvalBody(toolName: string, args: Record<string, unknown>) {
  const safeArgs = Object.fromEntries(
    Object.entries(args).flatMap(([key, value]) => {
      if (key === "text" || key === "value") {
        return [[key, `<redacted ${typeof value === "string" ? value.length : 0} characters>`]]
      }
      return [[key, value]]
    }),
  )
  return [
    "Anybox Computer Use",
    `Action: ${toolName}`,
    `Arguments: ${JSON.stringify(safeArgs)}`,
  ].join("\n")
}

function respectConfiguredPolicy(
  intent: Tool.ToolPermissionIntent,
  policy: Config.McpToolPolicyValue | undefined,
) {
  if (policy !== "ask" || intent.action !== "allow") return intent
  return {
    ...intent,
    action: "ask" as const,
    forceAsk: true,
    reason: `${intent.reason ?? "Computer Use access requested."} The user's MCP policy requires approval.`,
  }
}
