import { useEffect, useMemo, useState, type ReactNode } from "react"
import { ChevronDownIcon, ChevronRightIcon, ToolsIcon } from "../icons"
import { ShellTopMenu } from "../shared-ui"
import type { BuiltinToolSummary } from "../types"

interface BuiltinToolsPageProps {
  activeToolKind?: BuiltinToolKindKey | null
  builtinTools: BuiltinToolSummary[]
  builtinToolsError: string | null
  hideNavigator?: boolean
  isBuiltinToolSelectionDirty: boolean
  isLoadingBuiltinTools: boolean
  isSavingBuiltinTools: boolean
  windowControls?: ReactNode
  onActiveToolKindChange?: (kind: BuiltinToolKindKey | null) => void
  onBuiltinToolToggle: (toolID: string, enabled: boolean) => void
  onResetBuiltinTools: () => boolean | Promise<boolean>
  onSaveBuiltinTools: () => boolean | Promise<boolean>
}

export interface BuiltinToolsSidebarViewProps {
  activeToolKind: BuiltinToolKindKey | null
  builtinTools: BuiltinToolSummary[]
  onActiveToolKindChange: (kind: BuiltinToolKindKey) => void
}

function formatJson(value: unknown) {
  if (value === undefined) return "{}"

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function getBuiltinToolKindLabelForKind(kind: BuiltinToolSummary["capabilities"]["kind"] | "other") {
  switch (kind) {
    case "exec":
      return "Shell"
    case "write":
      return "Write"
    case "search":
      return "Search"
    case "read":
      return "Read"
    case "workflow":
      return "Workflow"
    case "interaction":
      return "Interaction"
    case "delegation":
      return "Delegation"
    default:
      return "Other"
  }
}

function getBuiltinToolKindLabel(tool: BuiltinToolSummary) {
  return getBuiltinToolKindLabelForKind(tool.capabilities.kind ?? "other")
}

function getBuiltinToolGroupLabel(kind: BuiltinToolKindKey) {
  if (kind === "shell") return "Shell"
  if (kind === "files") return "File Tools"
  if (kind === "delegation") return "Multi-Agent Tools"
  if (kind === "product_interaction") return "Product Interaction Tools"
  if (kind === "code") return "Code Tools"
  if (kind === "plugin_skill_mcp") return "Plugin, Skill & MCP Tools"
  return getBuiltinToolKindLabelForKind(kind)
}

function getBuiltinToolRiskLabel(tool: BuiltinToolSummary) {
  if (tool.capabilities.needsShell || tool.capabilities.kind === "exec") return "Shell access"
  if (tool.capabilities.kind === "delegation") return tool.capabilities.readOnly ? "Delegation status" : "Delegates work"
  if (tool.capabilities.kind === "workflow") return "Workflow control"
  if (tool.capabilities.kind === "interaction") return "User interaction"
  if (tool.capabilities.destructive) return "High risk"
  if (tool.capabilities.readOnly) return "Read-only"
  return "Moderate"
}

function getBuiltinToolRiskBadgeClassName(tool: BuiltinToolSummary) {
  if (
    tool.capabilities.needsShell ||
    tool.capabilities.kind === "exec" ||
    tool.capabilities.destructive ||
    (tool.capabilities.kind === "delegation" && !tool.capabilities.readOnly) ||
    (tool.capabilities.kind === "workflow" && !tool.capabilities.readOnly)
  ) {
    return "tools-badge is-warning"
  }
  if (tool.capabilities.readOnly) {
    return "tools-badge is-highlight"
  }
  return "tools-badge"
}

export const builtinToolKindOrder = [
  "shell",
  "files",
  "delegation",
  "product_interaction",
  "code",
  "plugin_skill_mcp",
  "workflow",
  "interaction",
  "search",
  "read",
  "other",
] as const
export type BuiltinToolKindKey = (typeof builtinToolKindOrder)[number]

const shellToolIDs = new Set([
  "git_bash_command",
  "powershell_command",
  "cmd_command",
  "wsl_bash_command",
  "macos_shell_command",
  "ssh_shell_command",
])

const fileToolIDs = new Set([
  "read_file",
  "list_directory",
  "replace_text",
  "apply_patch",
  "view_image",
  "glob",
  "grep",
])

const productInteractionToolIDs = new Set([
  "ask_user_question",
  "task_create",
  "task_get",
  "task_list",
  "task_update",
])

const codeToolIDs = new Set([
  "lsp_definition",
  "lsp_references",
  "lsp_hover",
  "lsp_workspace_symbols",
])

const pluginSkillMcpToolIDs = new Set([
  "load_skill",
  "read_skill_resource",
  "list_mcp_resources",
  "list_mcp_resource_templates",
  "read_mcp_resource",
  "tool_search",
])

interface BuiltinToolGroup {
  kind: BuiltinToolKindKey
  label: string
  items: BuiltinToolSummary[]
  enabledCount: number
}

function getBuiltinToolGroupToolsLabel(group: BuiltinToolGroup) {
  return group.label.endsWith("Tools") ? group.label : `${group.label} tools`
}

function getBuiltinToolGroupDescription(kind: BuiltinToolKindKey) {
  switch (kind) {
    case "shell":
      return "Platform-specific shell commands available to the agent."
    case "files":
      return "Tools for reading, browsing, searching, and modifying workspace files."
    case "delegation":
      return "Subagent coordination tools for delegated work and status checks."
    case "product_interaction":
      return "Tools that improve how users and agents clarify, structure, and track work."
    case "code":
      return "Language-aware tools for navigating symbols, definitions, references, and code information."
    case "plugin_skill_mcp":
      return "Tools for loading Skills and discovering or reading plugin and MCP capabilities and resources."
    case "workflow":
      return "Workflow controls that affect task execution and continuation."
    case "interaction":
      return "User-facing interaction tools that ask for input or confirmation."
    case "search":
      return "Search and discovery tools used to locate project context."
    case "read":
      return "Read-only tools used to inspect files, state, and context."
    default:
      return "Built-in tools that do not fit another category."
  }
}

function toolMatchesID(tool: BuiltinToolSummary, toolIDs: ReadonlySet<string>) {
  return toolIDs.has(tool.id) || tool.aliases.some((alias) => toolIDs.has(alias))
}

function getBuiltinToolGroupKind(tool: BuiltinToolSummary): BuiltinToolKindKey {
  if (toolMatchesID(tool, shellToolIDs)) return "shell"
  if (toolMatchesID(tool, fileToolIDs)) return "files"
  if (toolMatchesID(tool, productInteractionToolIDs)) return "product_interaction"
  if (toolMatchesID(tool, codeToolIDs)) return "code"
  if (toolMatchesID(tool, pluginSkillMcpToolIDs)) return "plugin_skill_mcp"

  const kind = tool.capabilities.kind ?? "other"
  return kind === "exec" || kind === "write" ? "other" : kind
}

export function BuiltinToolsSidebarView({
  activeToolKind,
  builtinTools,
  onActiveToolKindChange,
}: BuiltinToolsSidebarViewProps) {
  const builtinToolGroups = useMemo(() => buildBuiltinToolGroups(builtinTools), [builtinTools])

  return (
    <section className="sidebar-view sidebar-view-tools" aria-label="Built-in tool categories sidebar view">
      <div className="skills-tree-root tools-category-list" role="list" aria-label="Tool categories">
        {builtinToolGroups.map((group) => {
          const isActive = group.kind === activeToolKind

          return (
            <button
              key={group.kind}
              className={isActive ? "skill-tree-row tools-category-item is-active" : "skill-tree-row tools-category-item"}
              aria-label={`${getBuiltinToolGroupToolsLabel(group)}, ${group.enabledCount} of ${group.items.length} enabled`}
              aria-pressed={isActive}
              type="button"
              onClick={() => onActiveToolKindChange(group.kind)}
            >
              <span className="skill-tree-label">{group.label}</span>
              <span className="prompt-tree-row-badges" aria-hidden="true">
                <span className="tools-badge">{group.items.length}</span>
                <span className="tools-badge">
                  {group.enabledCount}/{group.items.length}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function buildBuiltinToolGroups(builtinTools: BuiltinToolSummary[]): BuiltinToolGroup[] {
  return builtinToolKindOrder
    .map((kind) => {
      const items = builtinTools.filter((tool) => getBuiltinToolGroupKind(tool) === kind)
      return {
        kind,
        label: getBuiltinToolGroupLabel(kind),
        items,
        enabledCount: items.filter((tool) => tool.enabled).length,
      }
    })
    .filter((group) => group.items.length > 0)
}

export function BuiltinToolsPage({
  activeToolKind: controlledActiveToolKind,
  builtinTools,
  builtinToolsError,
  hideNavigator = false,
  isBuiltinToolSelectionDirty,
  isLoadingBuiltinTools,
  isSavingBuiltinTools,
  windowControls,
  onActiveToolKindChange,
  onBuiltinToolToggle,
  onResetBuiltinTools,
  onSaveBuiltinTools,
}: BuiltinToolsPageProps) {
  const [internalActiveToolKind, setInternalActiveToolKind] = useState<BuiltinToolKindKey | null>(null)
  const [expandedToolIDs, setExpandedToolIDs] = useState<Set<string>>(() => new Set())
  const enabledBuiltinToolCount = builtinTools.filter((tool) => tool.enabled).length
  const builtinToolGroups = useMemo(() => buildBuiltinToolGroups(builtinTools), [builtinTools])
  const activeToolKind = controlledActiveToolKind ?? internalActiveToolKind
  const activeToolGroup = builtinToolGroups.find((group) => group.kind === activeToolKind) ?? builtinToolGroups[0] ?? null

  function setActiveToolKind(nextKind: BuiltinToolKindKey | null) {
    if (onActiveToolKindChange) {
      onActiveToolKindChange(nextKind)
      return
    }

    setInternalActiveToolKind(nextKind)
  }

  useEffect(() => {
    const firstKind = builtinToolGroups[0]?.kind ?? null
    if (!firstKind) {
      if (activeToolKind !== null) {
        setActiveToolKind(null)
      }
      return
    }

    if (!activeToolKind || !builtinToolGroups.some((group) => group.kind === activeToolKind)) {
      setActiveToolKind(firstKind)
    }
  }, [activeToolKind, builtinToolGroups])

  const toggleExpandedTool = (toolID: string) => {
    setExpandedToolIDs((currentToolIDs) => {
      const nextToolIDs = new Set(currentToolIDs)
      if (nextToolIDs.has(toolID)) {
        nextToolIDs.delete(toolID)
      } else {
        nextToolIDs.add(toolID)
      }
      return nextToolIDs
    })
  }

  return (
    <section className="builtin-tools-page tools-page" aria-label="Built-in tools">
      <ShellTopMenu
        as="header"
        ariaLabel="Tools top menu"
        className="canvas-region-top-menu tools-top-menu"
        contentClassName="canvas-region-top-menu-tabs-shell"
        content={(
          <div className="tools-top-menu-label">
            <ToolsIcon />
            <span>Tools</span>
          </div>
        )}
        dragRegion
        layout="three-column"
        trailing={windowControls}
        trailingClassName="tools-top-menu-window-controls"
      />

      <div className="tools-page-main">
        {builtinToolsError ? <div className="tools-banner is-error">{builtinToolsError}</div> : null}

        {isLoadingBuiltinTools ? (
          <article className="tools-empty-state">
            <span className="label">Loading</span>
            <h3>Fetching built-in tools</h3>
            <p>Reading the built-in registry and saved global availability limits.</p>
          </article>
        ) : (
          <section className={hideNavigator ? "tools-layout is-sidebar-hosted" : "tools-layout"} aria-label="Built-in tools">
            {!hideNavigator ? (
              <div className="tools-category-panel">
                <div className="tools-category-body">
                  <BuiltinToolsSidebarView
                    activeToolKind={activeToolGroup?.kind ?? null}
                    builtinTools={builtinTools}
                    onActiveToolKindChange={setActiveToolKind}
                  />
                </div>
              </div>
            ) : null}

            <div className="tools-detail-panel">
              {activeToolGroup ? (
                <>
                  <div className="tools-detail-hero">
                    <div>
                      <span className="label">Built-in tools</span>
                      <h3>{activeToolGroup.label}</h3>
                      <p className="tools-page-copy">
                        {getBuiltinToolGroupDescription(activeToolGroup.kind)}
                      </p>
                    </div>

                    <div className="tools-detail-statuses">
                      <span className="tools-badge">
                        {activeToolGroup.enabledCount}/{activeToolGroup.items.length} enabled
                      </span>
                      <span className="tools-badge">
                        {enabledBuiltinToolCount}/{builtinTools.length} total enabled
                      </span>
                    </div>
                  </div>

                  <section className="tools-panel tools-detail-section" aria-label={getBuiltinToolGroupToolsLabel(activeToolGroup)}>
                    <div className="tools-detail-header">
                      <div>
                        <span className="label">Availability</span>
                        <h2>Global tool availability</h2>
                        <p>
                          {enabledBuiltinToolCount} of {builtinTools.length} built-in tools enabled.
                        </p>
                      </div>
                      <div className="tools-detail-actions">
                        <button
                          className="secondary-button"
                          type="button"
                          disabled={isSavingBuiltinTools}
                          onClick={() => void onResetBuiltinTools()}
                        >
                          {isSavingBuiltinTools ? "Resetting..." : "Reset to default"}
                        </button>
                        <button
                          className="primary-button"
                          type="button"
                          disabled={!isBuiltinToolSelectionDirty || isSavingBuiltinTools}
                          onClick={() => void onSaveBuiltinTools()}
                        >
                          {isSavingBuiltinTools ? "Saving..." : "Save changes"}
                        </button>
                      </div>
                    </div>

                    <div className="tools-card-list">
                      {activeToolGroup.items.map((tool) => {
                        const isExpanded = expandedToolIDs.has(tool.id)
                        const detailsID = `builtin-tool-details-${tool.id}`

                        return (
                          <article
                            key={tool.id}
                            className={[
                              "tools-toggle-card",
                              "tools-card",
                              "tools-card-accordion",
                              tool.enabled ? "is-active" : "",
                              isExpanded ? "is-expanded" : "",
                            ].filter(Boolean).join(" ")}
                          >
                            <div className="tools-card-row">
                              <button
                                className="tools-card-expander"
                                type="button"
                                aria-expanded={isExpanded}
                                aria-controls={detailsID}
                                aria-label={`${isExpanded ? "Hide" : "Show"} details for ${tool.title}`}
                                onClick={() => toggleExpandedTool(tool.id)}
                              >
                                <span className="tools-card-expander-icon" aria-hidden="true">
                                  {isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
                                </span>
                                <strong className="tools-card-title">{tool.title}</strong>
                                <span className="tools-card-id">{tool.id}</span>
                              </button>
                              <div className="tools-card-row-actions">
                                <span className="tools-card-meta tools-card-meta-inline">
                                  <span className="tools-badge">{getBuiltinToolKindLabel(tool)}</span>
                                  <span className={getBuiltinToolRiskBadgeClassName(tool)}>
                                    {getBuiltinToolRiskLabel(tool)}
                                  </span>
                                  {tool.aliases.length > 0 ? (
                                    <span className="tools-badge">{tool.aliases.length} aliases</span>
                                  ) : null}
                                </span>
                                <button
                                  className="tools-card-toggle-button"
                                  type="button"
                                  role="switch"
                                  aria-checked={tool.enabled}
                                  aria-label={tool.title}
                                  disabled={isSavingBuiltinTools}
                                  onClick={() => onBuiltinToolToggle(tool.id, !tool.enabled)}
                                >
                                  <span className="tools-toggle-control" aria-hidden="true">
                                    <span className="tools-toggle-thumb" />
                                  </span>
                                </button>
                              </div>
                            </div>

                            {isExpanded ? (
                              <div className="tools-card-details" id={detailsID}>
                                <dl className="tools-card-detail-grid">
                                  <div className="tools-card-detail-item is-description">
                                    <dt>Description</dt>
                                    <dd title={tool.description}>{tool.description}</dd>
                                  </div>
                                  <div className="tools-card-detail-item">
                                    <dt>Tool ID</dt>
                                    <dd>{tool.id}</dd>
                                  </div>
                                  <div className="tools-card-detail-item">
                                    <dt>Concurrency</dt>
                                    <dd>{tool.capabilities.concurrency ?? "default"}</dd>
                                  </div>
                                  <div className="tools-card-detail-item">
                                    <dt>Aliases</dt>
                                    <dd>{tool.aliases.length > 0 ? tool.aliases.join(", ") : "None"}</dd>
                                  </div>
                                </dl>
                                <div className="tools-card-input-schema">
                                  <span className="tools-card-detail-label">Input schema</span>
                                  <pre>{formatJson(tool.inputSchema ?? {})}</pre>
                                </div>
                              </div>
                            ) : null}
                          </article>
                        )
                      })}
                    </div>
                  </section>
                </>
              ) : (
                <article className="tools-empty-state tools-detail-empty-state">
                  <h3>No built-in tools</h3>
                  <p>The agent registry did not return any built-in tools.</p>
                </article>
              )}
            </div>
          </section>
        )}
      </div>
    </section>
  )
}
