import type {
  McpServerSummary,
  McpServerDiagnostic,
  McpServerDraftState,
  McpToolDiagnostic,
  McpToolPolicyValue,
} from "../types"

export type McpToolPolicyDraft = Pick<
  McpServerDraftState,
  "transport" | "allowedToolsMode" | "allowedToolNames" | "toolPolicies"
>

function parseLineList(input: string) {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

export function recommendedMcpToolPolicy(tool: McpToolDiagnostic): McpToolPolicyValue {
  return tool.recommendedPolicy ?? (
    tool.annotations?.readOnlyHint === true && tool.annotations?.destructiveHint !== true ? "auto" : "ask"
  )
}

export function defaultMcpToolPolicyForDraft(
  tool: McpToolDiagnostic,
  draft: McpToolPolicyDraft,
): McpToolPolicyValue {
  if (draft.transport !== "stdio") {
    const allowedToolNames = new Set(parseLineList(draft.allowedToolNames))
    const requiresNamedTool =
      draft.allowedToolsMode === "names" || draft.allowedToolsMode === "read-only-names"
    const requiresReadOnly =
      draft.allowedToolsMode === "read-only" || draft.allowedToolsMode === "read-only-names"

    if (requiresNamedTool && !allowedToolNames.has(tool.name)) {
      return "disabled"
    }

    if (requiresReadOnly && tool.annotations?.readOnlyHint !== true) {
      return "disabled"
    }
  }

  // The agent treats a non-empty policy map as authoritative and requires
  // approval for tools that are not explicitly listed in it.
  if (Object.keys(draft.toolPolicies).length > 0) {
    return "ask"
  }

  return "auto"
}

export function resolveMcpToolPolicy(
  tool: McpToolDiagnostic,
  draft: McpToolPolicyDraft,
): McpToolPolicyValue {
  return draft.toolPolicies[tool.name] ?? defaultMcpToolPolicyForDraft(tool, draft)
}

export function mcpToolPolicyDraftFromServer(server: McpServerSummary): McpToolPolicyDraft {
  const allowedTools = server.transport === "stdio" ? undefined : server.allowedTools
  const allowedToolNames = Array.isArray(allowedTools)
    ? allowedTools
    : allowedTools?.toolNames ?? []
  const allowedToolsMode: McpServerDraftState["allowedToolsMode"] = !allowedTools
    ? "all"
    : Array.isArray(allowedTools)
      ? "names"
      : allowedTools.readOnly && allowedToolNames.length > 0
        ? "read-only-names"
        : allowedTools.readOnly
          ? "read-only"
          : allowedToolNames.length > 0
            ? "names"
            : "all"

  return {
    transport: server.transport,
    allowedToolsMode,
    allowedToolNames: allowedToolNames.join("\n"),
    toolPolicies: Object.fromEntries(
      Object.entries(server.toolPolicies ?? {}).map(([toolName, value]) => [toolName, value.policy]),
    ),
  }
}

export function mergeMcpToolPolicyDefaults(
  draft: McpServerDraftState,
  diagnostic: McpServerDiagnostic,
): McpServerDraftState {
  const tools = diagnostic.tools ?? []
  if (!diagnostic.ok || tools.length === 0) return draft

  let changed = false
  const toolPolicies = { ...draft.toolPolicies }
  for (const tool of tools) {
    if (toolPolicies[tool.name]) continue
    toolPolicies[tool.name] = tool.configuredPolicy ?? defaultMcpToolPolicyForDraft(tool, draft)
    changed = true
  }

  return changed ? { ...draft, toolPolicies } : draft
}
