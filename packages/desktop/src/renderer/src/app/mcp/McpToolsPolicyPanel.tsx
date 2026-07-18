import { useState } from "react"
import { ChevronDownIcon, ChevronRightIcon } from "../icons"
import type {
  McpServerDiagnostic,
  McpToolDiagnostic,
  McpToolPolicyValue,
} from "../types"
import { SettingsSelect } from "../settings/SettingsSelect"
import { resolveMcpToolPolicy, type McpToolPolicyDraft } from "./mcp-tool-policies"

const TOOL_POLICY_LABELS: Record<McpToolPolicyValue, string> = {
  disabled: "Disabled",
  ask: "Ask every time",
  auto: "Auto allow",
}

const EMPTY_TOOL_NAME_SET: ReadonlySet<string> = new Set()

function formatJson(value: unknown) {
  if (value === undefined) return "{}"

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function toolBadges(tool: McpToolDiagnostic) {
  const badges: string[] = []
  if (tool.annotations?.readOnlyHint) badges.push("read-only")
  if (tool.annotations?.destructiveHint) badges.push("destructive")
  if (tool.annotations?.openWorldHint) badges.push("open-world")
  if (badges.length === 0) badges.push(tool.riskHint)
  return badges
}

function getToolDetailsID(toolName: string, index: number) {
  return `mcp-tool-policy-details-${index}-${toolName.replace(/[^a-zA-Z0-9_-]+/g, "-")}`
}

interface McpToolsPolicyPanelProps {
  diagnostic: McpServerDiagnostic | null
  disabled?: boolean
  draft: McpToolPolicyDraft
  onPolicyChange: (toolName: string, policy: McpToolPolicyValue) => void
}

interface ExpandedToolState {
  serverID: string | null
  names: ReadonlySet<string>
}

export function McpToolsPolicyPanel({
  diagnostic,
  disabled = false,
  draft,
  onPolicyChange,
}: McpToolsPolicyPanelProps) {
  const [expandedToolState, setExpandedToolState] = useState<ExpandedToolState>(() => ({
    serverID: null,
    names: EMPTY_TOOL_NAME_SET,
  }))

  if (!diagnostic?.ok) return null
  const tools = diagnostic.tools ?? []
  const activeServerID = diagnostic.serverID
  const expandedToolNames = expandedToolState.serverID === activeServerID ? expandedToolState.names : EMPTY_TOOL_NAME_SET

  function toggleToolDetails(toolName: string) {
    setExpandedToolState((current) => {
      const currentNames = current.serverID === activeServerID ? current.names : EMPTY_TOOL_NAME_SET
      const next = new Set(currentNames)
      if (next.has(toolName)) {
        next.delete(toolName)
      } else {
        next.add(toolName)
      }
      return {
        serverID: activeServerID,
        names: next,
      }
    })
  }

  return (
    <section className="mcp-tools-policy-panel" aria-label="MCP tool permissions">
      <div className="settings-section-header">
        <div>
          <span className="label">Tools</span>
          <h3>Tool Permissions</h3>
        </div>
      </div>

      {tools.length > 0 ? (
        <div className="mcp-tools-policy-list">
          {tools.map((tool, index) => {
            const policy = resolveMcpToolPolicy(tool, draft)
            const isExpanded = expandedToolNames.has(tool.name)
            const detailsID = getToolDetailsID(tool.name, index)

            return (
              <article
                className={isExpanded ? "mcp-tool-policy-card is-expanded" : "mcp-tool-policy-card"}
                key={tool.name}
              >
                <div className="mcp-tool-policy-main">
                  <div className="mcp-tool-policy-heading">
                    <button
                      aria-controls={detailsID}
                      aria-expanded={isExpanded}
                      aria-label={`${isExpanded ? "Hide" : "Show"} details for ${tool.name}`}
                      className="mcp-tool-policy-toggle"
                      onClick={() => toggleToolDetails(tool.name)}
                      title={`${isExpanded ? "Hide" : "Show"} tool details`}
                      type="button"
                    >
                      <span className="mcp-tool-policy-toggle-icon">
                        {isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
                      </span>
                      <span className="mcp-tool-policy-title-group">
                        <span className="mcp-tool-policy-title">{tool.displayName || tool.title || tool.name}</span>
                        <code>{tool.name}</code>
                      </span>
                    </button>
                    <div className="provider-row-statuses">
                      {toolBadges(tool).map((badge) => (
                        <span
                          className={badge === "destructive" ? "settings-badge is-danger" : "settings-badge"}
                          key={badge}
                        >
                          {badge}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="settings-field mcp-tool-policy-select">
                  <SettingsSelect<McpToolPolicyValue>
                    ariaLabel={`Policy for ${tool.name}`}
                    disabled={disabled}
                    options={[
                      { value: "disabled", label: TOOL_POLICY_LABELS.disabled },
                      { value: "ask", label: TOOL_POLICY_LABELS.ask },
                      { value: "auto", label: TOOL_POLICY_LABELS.auto },
                    ]}
                    value={policy}
                    onChange={(value) => onPolicyChange(tool.name, value)}
                  />
                </div>

                {isExpanded ? (
                  <div className="mcp-tool-policy-details" id={detailsID}>
                    {tool.description ? <p>{tool.description}</p> : null}
                    <div className="mcp-tool-policy-schema">
                      <span className="mcp-tool-policy-details-label">Input schema</span>
                      <pre>{formatJson({
                        inputSchema: tool.inputSchema ?? {},
                        annotations: tool.annotations ?? {},
                      })}</pre>
                    </div>
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      ) : (
        <article className="settings-empty-state">
          <span className="label">No Tools</span>
          <h3>No MCP tools discovered</h3>
          <p>This server responded successfully but did not expose any tools.</p>
        </article>
      )}
    </section>
  )
}
