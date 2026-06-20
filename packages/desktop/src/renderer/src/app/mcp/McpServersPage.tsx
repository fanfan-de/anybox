import { useMemo, useState, type ReactNode } from "react"
import {
  CloseIcon,
  DeleteIcon,
  DownloadIcon,
  FolderIcon,
  PlusIcon,
  SearchIcon,
} from "../icons"
import { useI18n } from "../i18n/I18nProvider"
import { ShellTopMenu } from "../shared-ui"
import type {
  InstalledPlugin,
  McpServerDiagnostic,
  McpServerDraftState,
  McpServerSummary,
  McpToolDiagnostic,
  McpToolPolicyValue,
  PluginCatalogItem,
} from "../types"
import { parseMcpConfigJson } from "./mcp-config-import"
import {
  buildMcpServerPluginSourceMap,
  getMcpServerPluginSource,
  getMcpServerPluginSourceAriaLabel,
  getMcpServerPluginSourceSearchText,
  getMcpServerPluginSourceTitle,
  type McpServerPluginSource,
} from "./mcp-server-source"
import { McpToolsPolicyPanel } from "./McpToolsPolicyPanel"

interface McpServersPageProps {
  activeMcpServerID: string | null
  activeMcpServerDiagnostic: McpServerDiagnostic | null
  deletingMcpServerID: string | null
  isLoading: boolean
  loadError: string | null
  mcpServerDraft: McpServerDraftState
  mcpServers: McpServerSummary[]
  installedPlugins?: InstalledPlugin[]
  pluginCatalog?: PluginCatalogItem[]
  savingMcpServerID: string | null
  hideNavigator?: boolean
  hideTopMenu?: boolean
  isImportingMcpConfigJson?: boolean
  searchQuery?: string
  windowControls?: ReactNode
  onDeleteMcpServer: (serverID: string) => void | Promise<void>
  onImportMcpConfigJson: (input: string) => boolean | Promise<boolean>
  onMcpServerDraftChange: (field: keyof McpServerDraftState, value: string | boolean) => void
  onMcpToolPolicyChange: (toolName: string, policy: McpToolPolicyValue) => void
  onMcpServerSelect: (serverID: string) => void
  onSaveMcpServer: () => boolean | Promise<boolean>
  onSearchQueryChange?: (value: string) => void
  onStartNewMcpServer: () => void
}

export interface McpServersSidebarViewProps {
  activeMcpServerID: string | null
  deletingMcpServerID: string | null
  isImportingMcpConfigJson?: boolean
  installedPlugins?: InstalledPlugin[]
  mcpServers: McpServerSummary[]
  pluginCatalog?: PluginCatalogItem[]
  savingMcpServerID: string | null
  searchQuery?: string
  onMcpServerSelect: (serverID: string) => void
  onSearchQueryChange?: (value: string) => void
  onStartNewMcpServer: () => void
}

function getMcpTransportLabel(transport: McpServerSummary["transport"] | McpServerDraftState["transport"]) {
  if (transport === "remote") return "http"
  if (transport === "connector") return "connector"
  return "stdio"
}

function getMcpToolLabel(tool: McpToolDiagnostic) {
  return tool.displayName || tool.title || tool.name
}

function getMcpServerLookupText(server: McpServerSummary, pluginSource: McpServerPluginSource | null = null) {
  return [
    server.id,
    server.name ?? "",
    server.transport,
    server.transport === "stdio" ? server.command : server.transport === "remote" ? server.serverUrl ?? "" : server.connectorId,
    server.transport === "stdio" ? server.args?.join(" ") ?? "" : server.serverDescription ?? "",
    getMcpServerPluginSourceSearchText(pluginSource),
  ].join(" ").toLowerCase()
}

interface McpServerVisualProfile {
  category: string
  displayName: string
}

function getMcpServerVisualProfile(
  server: McpServerSummary,
  pluginSource: McpServerPluginSource | null = null,
): McpServerVisualProfile {
  const lookupText = getMcpServerLookupText(server, pluginSource)
  const displayName = server.name ?? server.id

  if (lookupText.includes("github")) {
    return {
      category: "Code hosting",
      displayName,
    }
  }

  if (lookupText.includes("context7")) {
    return {
      category: "Documentation",
      displayName,
    }
  }

  if (lookupText.includes("filesystem") || lookupText.includes("file-system")) {
    return {
      category: "Local files",
      displayName,
    }
  }

  if (lookupText.includes("notion")) {
    return {
      category: "Workspace knowledge",
      displayName,
    }
  }

  if (lookupText.includes("browser") || lookupText.includes("playwright") || lookupText.includes("chrome")) {
    return {
      category: "Browser automation",
      displayName,
    }
  }

  if (
    lookupText.includes("postgres") ||
    lookupText.includes("supabase") ||
    lookupText.includes("database") ||
    lookupText.includes("sqlite")
  ) {
    return {
      category: "Database",
      displayName,
    }
  }

  return {
    category: "MCP server",
    displayName,
  }
}

function getMcpPurposeText(
  activeMcpServer: McpServerSummary,
  diagnostic: McpServerDiagnostic | null,
) {
  if (activeMcpServer.transport === "remote" && activeMcpServer.serverDescription?.trim()) {
    return activeMcpServer.serverDescription.trim()
  }

  if (diagnostic?.ok) {
    const tools = diagnostic.tools ?? []
    if (tools.length === 0) {
      return "This server is connected, but it did not expose usable tools yet."
    }

    const toolNames = tools.slice(0, 3).map(getMcpToolLabel)
    const remainingCount = tools.length - toolNames.length
    const toolSummary = remainingCount > 0
      ? `${toolNames.join(", ")}, and ${remainingCount} more`
      : toolNames.join(", ")
    return `This MCP makes ${toolSummary} available to the assistant.`
  }

  if (diagnostic && !diagnostic.ok) {
    return "Tool discovery failed, so the available capabilities are unknown."
  }

  if (activeMcpServer.transport === "stdio") {
    return `Runs a local MCP process with ${activeMcpServer.command || "a configured command"} to add tools to the assistant.`
  }

  return "Connects to a remote MCP endpoint to add external tools to the assistant."
}

function splitEditorLines(value: string) {
  if (!value) return []
  return value.replace(/\r\n/g, "\n").split("\n")
}

function serializeEditorLines(lines: string[]) {
  return lines.join("\n")
}

function getVisibleEditorLines(value: string) {
  const lines = splitEditorLines(value)
  return lines.length > 0 ? lines : [""]
}

interface KeyValueEditorRow {
  key: string
  value: string
}

function splitKeyValueEditorRows(value: string): KeyValueEditorRow[] {
  return splitEditorLines(value).map((line) => {
    const separatorIndex = line.indexOf("=")
    if (separatorIndex < 0) {
      return {
        key: line,
        value: "",
      }
    }

    return {
      key: line.slice(0, separatorIndex),
      value: line.slice(separatorIndex + 1),
    }
  })
}

function serializeKeyValueEditorRows(rows: KeyValueEditorRow[]) {
  return rows.map((row) => (row.key || row.value ? `${row.key}=${row.value}` : "")).join("\n")
}

function getVisibleKeyValueEditorRows(value: string) {
  const rows = splitKeyValueEditorRows(value)
  return rows.length > 0 ? rows : [{ key: "", value: "" }]
}

function doesMcpServerMatchSearch(
  server: McpServerSummary,
  rawQuery: string,
  pluginSource: McpServerPluginSource | null = null,
) {
  const query = rawQuery.trim().toLowerCase()
  if (!query) return true

  const haystack = [
    server.id,
    server.name ?? "",
    getMcpTransportLabel(server.transport),
    server.enabled ? "enabled" : "disabled",
    server.transport === "stdio" ? server.command ?? "" : server.transport === "remote" ? server.serverUrl ?? "" : server.connectorId,
    getMcpServerPluginSourceSearchText(pluginSource),
  ]
    .join(" ")
    .toLowerCase()

  return haystack.includes(query)
}

const MCP_CONFIG_IMPORT_EXAMPLE = `{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:\\\\Projects"]
    },
    "context7": {
      "type": "http",
      "url": "https://mcp.context7.com/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN"
      }
    }
  }
}`

function getMcpServerValidationError(draft: McpServerDraftState) {
  if (!draft.id.trim()) {
    return "MCP servers require an id."
  }

  if (draft.transport === "stdio" && !draft.command.trim()) {
    return "Local MCP servers require a command."
  }

  if (draft.transport === "remote" && !draft.serverUrl.trim()) {
    return "Remote MCP servers require a server URL."
  }

  if (draft.transport === "connector" && !draft.connectorId.trim()) {
    return "Connector MCP servers require a connector id."
  }

  if (
    draft.transport !== "stdio" &&
    (draft.allowedToolsMode === "names" || draft.allowedToolsMode === "read-only-names") &&
    !draft.allowedToolNames.trim()
  ) {
    return "Named tool filters require at least one tool name."
  }

  return null
}

interface McpServerOverviewCardProps {
  activeMcpServer: McpServerSummary | null
  diagnostic: McpServerDiagnostic | null
  pluginSource: McpServerPluginSource | null
}

function McpServerOverviewCard({
  activeMcpServer,
  diagnostic,
  pluginSource,
}: McpServerOverviewCardProps) {
  if (!activeMcpServer) return null

  const visualProfile = getMcpServerVisualProfile(activeMcpServer, pluginSource)

  return (
    <section className="mcp-overview-card" aria-labelledby="mcp-overview-title">
      <div className="mcp-overview-header">
        <div className="mcp-overview-identity">
          <div className="mcp-overview-copy">
            <div className="mcp-overview-label-row">
              <span className="label">{visualProfile.category}</span>
              {pluginSource ? (
                <span className="mcp-server-source-chip" title={getMcpServerPluginSourceTitle(pluginSource)}>
                  {getMcpServerPluginSourceTitle(pluginSource)}
                </span>
              ) : null}
            </div>
            <h3 id="mcp-overview-title">{visualProfile.displayName}</h3>
            <p>{getMcpPurposeText(activeMcpServer, diagnostic)}</p>
          </div>
        </div>
      </div>
    </section>
  )
}

interface LineListEditorProps {
  addLabel: string
  label: string
  placeholder: string
  value: string
  onChange: (value: string) => void
}

function LineListEditor({
  addLabel,
  label,
  placeholder,
  value,
  onChange,
}: LineListEditorProps) {
  const rows = getVisibleEditorLines(value)

  function updateRow(index: number, nextValue: string) {
    const nextRows = [...rows]
    nextRows[index] = nextValue
    onChange(serializeEditorLines(nextRows))
  }

  function removeRow(index: number) {
    onChange(serializeEditorLines(rows.filter((_, rowIndex) => rowIndex !== index)))
  }

  function addRow() {
    onChange(serializeEditorLines([...rows, ""]))
  }

  return (
    <div className="mcp-editor-section">
      <h3>{label}</h3>
      <div className="mcp-line-editor">
        {rows.map((row, index) => (
          <div className="mcp-line-editor-row" key={`${label}:${index}`}>
            <input
              aria-label={`${label} ${index + 1}`}
              type="text"
              value={row}
              placeholder={placeholder}
              onChange={(event) => updateRow(index, event.target.value)}
            />
            <button
              aria-label={`Remove ${label} ${index + 1}`}
              className="mcp-editor-remove-button"
              disabled={!value && rows.length === 1}
              title="Remove"
              type="button"
              onClick={() => removeRow(index)}
            >
              <DeleteIcon />
            </button>
          </div>
        ))}
      </div>
      <button className="mcp-editor-add-button" type="button" onClick={addRow}>
        <PlusIcon />
        {addLabel}
      </button>
    </div>
  )
}

interface KeyValueEditorProps {
  addLabel: string
  keyPlaceholder: string
  label: string
  value: string
  valuePlaceholder: string
  onChange: (value: string) => void
}

function KeyValueEditor({
  addLabel,
  keyPlaceholder,
  label,
  value,
  valuePlaceholder,
  onChange,
}: KeyValueEditorProps) {
  const rows = getVisibleKeyValueEditorRows(value)

  function updateRow(index: number, field: keyof KeyValueEditorRow, nextValue: string) {
    const nextRows = [...rows]
    nextRows[index] = {
      ...nextRows[index],
      [field]: nextValue,
    }
    onChange(serializeKeyValueEditorRows(nextRows))
  }

  function removeRow(index: number) {
    onChange(serializeKeyValueEditorRows(rows.filter((_, rowIndex) => rowIndex !== index)))
  }

  function addRow() {
    onChange(serializeKeyValueEditorRows([...rows, { key: "", value: "" }]))
  }

  return (
    <div className="mcp-editor-section">
      <h3>{label}</h3>
      <div className="mcp-key-value-editor">
        {rows.map((row, index) => (
          <div className="mcp-key-value-editor-row" key={`${label}:${index}`}>
            <input
              aria-label={`${label} key ${index + 1}`}
              type="text"
              value={row.key}
              placeholder={keyPlaceholder}
              onChange={(event) => updateRow(index, "key", event.target.value)}
            />
            <input
              aria-label={`${label} value ${index + 1}`}
              type="text"
              value={row.value}
              placeholder={valuePlaceholder}
              onChange={(event) => updateRow(index, "value", event.target.value)}
            />
            <button
              aria-label={`Remove ${label} ${index + 1}`}
              className="mcp-editor-remove-button"
              disabled={!value && rows.length === 1}
              title="Remove"
              type="button"
              onClick={() => removeRow(index)}
            >
              <DeleteIcon />
            </button>
          </div>
        ))}
      </div>
      <button className="mcp-editor-add-button" type="button" onClick={addRow}>
        <PlusIcon />
        {addLabel}
      </button>
    </div>
  )
}

export function McpServersSidebarView({
  activeMcpServerID,
  deletingMcpServerID,
  isImportingMcpConfigJson = false,
  installedPlugins = [],
  mcpServers,
  pluginCatalog = [],
  savingMcpServerID,
  searchQuery,
  onMcpServerSelect,
  onSearchQueryChange,
  onStartNewMcpServer,
}: McpServersSidebarViewProps) {
  const { t } = useI18n()
  const [localMcpServerSearchQuery, setLocalMcpServerSearchQuery] = useState("")
  const hasExternalSearch = searchQuery !== undefined
  const effectiveSearchQuery = searchQuery ?? localMcpServerSearchQuery
  const activeMcpServer = activeMcpServerID ? mcpServers.find((server) => server.id === activeMcpServerID) ?? null : null
  const pluginSourceMap = useMemo(
    () => buildMcpServerPluginSourceMap(installedPlugins, pluginCatalog),
    [installedPlugins, pluginCatalog],
  )
  const filteredMcpServers = useMemo(
    () => mcpServers.filter((server) => doesMcpServerMatchSearch(
      server,
      effectiveSearchQuery,
      getMcpServerPluginSource(server, pluginSourceMap),
    )),
    [effectiveSearchQuery, mcpServers, pluginSourceMap],
  )

  function handleSearchQueryChange(value: string) {
    if (!hasExternalSearch) {
      setLocalMcpServerSearchQuery(value)
    }
    onSearchQueryChange?.(value)
  }

  return (
    <section
      className={hasExternalSearch ? "sidebar-view sidebar-view-mcp is-search-external" : "sidebar-view sidebar-view-mcp"}
      aria-label="MCP servers sidebar view"
    >
      {!hasExternalSearch ? (
        <div className="skills-tree-search-row mcp-servers-search-row" role="search">
          <SearchIcon />
          <input
            aria-label="Search MCP servers"
            type="search"
            value={effectiveSearchQuery}
            placeholder="Search servers"
            onChange={(event) => handleSearchQueryChange(event.target.value)}
          />
          {effectiveSearchQuery ? (
            <button
              aria-label="Clear MCP server search"
              title="Clear search"
              type="button"
              onClick={() => handleSearchQueryChange("")}
            >
              <CloseIcon />
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="skills-tree-root mcp-servers-list-stack" role="list" aria-label="MCP servers">
        {filteredMcpServers.length > 0 ? (
          filteredMcpServers.map((server) => {
            const isActive = server.id === activeMcpServerID
            const pluginSource = getMcpServerPluginSource(server, pluginSourceMap)
            const pluginSourceAriaLabel = pluginSource ? getMcpServerPluginSourceAriaLabel(pluginSource) : null

            return (
              <button
                key={server.id}
                className={isActive ? "skill-tree-row mcp-server-sidebar-row is-active" : "skill-tree-row mcp-server-sidebar-row"}
                aria-label={`${server.name ?? server.id}${pluginSourceAriaLabel ? ` ${pluginSourceAriaLabel}` : ""} ${server.enabled ? "enabled" : "disabled"}`}
                aria-pressed={isActive}
                type="button"
                onClick={() => onMcpServerSelect(server.id)}
              >
                <span className="mcp-server-sidebar-copy">
                  <span className="mcp-server-sidebar-name">{server.name ?? server.id}</span>
                  {pluginSource ? (
                    <span className="mcp-server-sidebar-source" title={getMcpServerPluginSourceTitle(pluginSource)}>
                      Plugin
                    </span>
                  ) : null}
                </span>
                <span className={server.enabled ? "mcp-server-sidebar-status is-enabled" : "mcp-server-sidebar-status"} aria-hidden="true">
                  {server.enabled ? "Enabled" : "Disabled"}
                </span>
              </button>
            )
          })
        ) : mcpServers.length > 0 ? (
          <p className="skills-tree-empty">{t("mcp.noMatchTitle")}.</p>
        ) : (
          <p className="skills-tree-empty">{t("mcp.noServersTitle")}.</p>
        )}

        <div className="global-skills-new-menu-shell mcp-servers-new-menu-shell">
          <button
            aria-label="New server"
            aria-pressed={!activeMcpServer}
            className={activeMcpServer ? "global-skills-new-button mcp-servers-new-button" : "global-skills-new-button mcp-servers-new-button is-active"}
            onClick={onStartNewMcpServer}
            title="New server"
            type="button"
          >
            <PlusIcon />
          </button>
        </div>
      </div>
    </section>
  )
}

export function McpServersPage({
  activeMcpServerID,
  activeMcpServerDiagnostic,
  deletingMcpServerID,
  isLoading,
  loadError,
  mcpServerDraft,
  mcpServers,
  installedPlugins = [],
  pluginCatalog = [],
  savingMcpServerID,
  hideNavigator = false,
  hideTopMenu = false,
  isImportingMcpConfigJson = false,
  searchQuery,
  windowControls,
  onDeleteMcpServer,
  onImportMcpConfigJson,
  onMcpServerDraftChange,
  onMcpToolPolicyChange,
  onMcpServerSelect,
  onSaveMcpServer,
  onSearchQueryChange,
  onStartNewMcpServer,
}: McpServersPageProps) {
  const { t } = useI18n()
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false)
  const [importConfigJson, setImportConfigJson] = useState("")
  const activeMcpServer = activeMcpServerID ? mcpServers.find((server) => server.id === activeMcpServerID) ?? null : null
  const pluginSourceMap = useMemo(
    () => buildMcpServerPluginSourceMap(installedPlugins, pluginCatalog),
    [installedPlugins, pluginCatalog],
  )
  const activeMcpServerPluginSource = activeMcpServer ? getMcpServerPluginSource(activeMcpServer, pluginSourceMap) : null
  const mcpServerBusyID = activeMcpServerID ?? mcpServerDraft.id.trim() ?? null
  const mcpServerBusy = Boolean(
    (mcpServerBusyID && savingMcpServerID === mcpServerBusyID) ||
    (mcpServerBusyID && deletingMcpServerID === mcpServerBusyID),
  )
  const mcpServerValidationError = getMcpServerValidationError(mcpServerDraft)
  const mcpServerCanSave = !mcpServerValidationError
  const isConnectorMcpServer = mcpServerDraft.transport === "connector"
  const importPreview = useMemo(() => {
    if (!importConfigJson.trim()) return null

    try {
      return {
        tone: "success" as const,
        result: parseMcpConfigJson(importConfigJson),
      }
    } catch (error) {
      return {
        tone: "error" as const,
        errorMessage: error instanceof Error ? error.message : String(error),
      }
    }
  }, [importConfigJson])
  const importServerCount = importPreview?.tone === "success" ? importPreview.result.servers.length : 0
  const canImportConfigJson = importServerCount > 0 && !isImportingMcpConfigJson

  async function handleImportConfigJson() {
    if (!canImportConfigJson) return

    const didImport = await onImportMcpConfigJson(importConfigJson)
    if (!didImport) return

    setIsImportDialogOpen(false)
    setImportConfigJson("")
  }

  return (
    <section className={hideTopMenu ? "mcp-servers-page is-embedded" : "mcp-servers-page"} aria-label="MCP servers">
      {!hideTopMenu ? (
        <ShellTopMenu
          as="header"
          ariaLabel="MCP top menu"
          className="canvas-region-top-menu mcp-servers-top-menu"
          contentClassName="canvas-region-top-menu-tabs-shell"
          content={(
            <div className="prompt-presets-top-menu-label">
              <FolderIcon />
              <span>MCP</span>
            </div>
          )}
          dragRegion
          layout="three-column"
          trailing={windowControls}
          trailingClassName="prompt-presets-top-menu-window-controls"
        />
      ) : null}

      <div className="settings-page-main is-services mcp-servers-page-main">
        {loadError ? <div className="settings-banner is-error">{loadError}</div> : null}

        {isLoading ? (
          <article className="settings-empty-state">
            <span className="label">Loading</span>
            <h3>Fetching MCP servers</h3>
            <p>Reading global MCP definitions, current defaults, and diagnostics.</p>
          </article>
        ) : (
          <section
            className={hideNavigator ? "settings-services-layout mcp-servers-page-layout is-sidebar-hosted" : "settings-services-layout mcp-servers-page-layout"}
            aria-label="MCP server layout"
          >
            {!hideNavigator ? (
              <div className="settings-service-list-panel mcp-servers-list-panel">
                <McpServersSidebarView
                  activeMcpServerID={activeMcpServerID}
                  deletingMcpServerID={deletingMcpServerID}
                  isImportingMcpConfigJson={isImportingMcpConfigJson}
                  installedPlugins={installedPlugins}
                  mcpServers={mcpServers}
                  pluginCatalog={pluginCatalog}
                  savingMcpServerID={savingMcpServerID}
                  searchQuery={searchQuery}
                  onMcpServerSelect={onMcpServerSelect}
                  onSearchQueryChange={onSearchQueryChange}
                  onStartNewMcpServer={onStartNewMcpServer}
                />
              </div>
            ) : null}

            <div className="settings-service-detail-panel mcp-server-detail-panel">
              <div className="mcp-server-detail-shell">
                <main className="mcp-server-main-column">
                  <McpServerOverviewCard
                    activeMcpServer={activeMcpServer}
                    diagnostic={activeMcpServerDiagnostic}
                    pluginSource={activeMcpServerPluginSource}
                  />

                  <section className="mcp-config-card" aria-labelledby="mcp-basic-settings-title">
                    <div className="mcp-config-card-header">
                      <h3 id="mcp-basic-settings-title">Server</h3>
                    </div>

                    <div className="settings-field-grid mcp-config-grid">
                      <label className="settings-field">
                        <span className="settings-field-label">Server ID</span>
                        <input
                          aria-label="MCP server id"
                          type="text"
                          value={mcpServerDraft.id}
                          placeholder="filesystem"
                          onChange={(event) => onMcpServerDraftChange("id", event.target.value)}
                        />
                      </label>

                      <label className="settings-field">
                        <span className="settings-field-label">Name</span>
                        <input
                          aria-label="MCP server name"
                          type="text"
                          value={mcpServerDraft.name}
                          placeholder="Filesystem"
                          onChange={(event) => onMcpServerDraftChange("name", event.target.value)}
                        />
                      </label>

                      <div className="settings-field mcp-transport-field">
                        <span className="settings-field-label">Transport</span>
                        <div
                          aria-label="MCP server transport"
                          className={isConnectorMcpServer ? "mcp-transport-segmented-control is-connector" : "mcp-transport-segmented-control"}
                          role="radiogroup"
                        >
                          <button
                            aria-checked={mcpServerDraft.transport === "stdio"}
                            className={
                              mcpServerDraft.transport === "stdio"
                                ? "mcp-transport-segment is-active"
                                : "mcp-transport-segment"
                            }
                            disabled={isConnectorMcpServer}
                            role="radio"
                            type="button"
                            onClick={() => onMcpServerDraftChange("transport", "stdio")}
                          >
                            STDIO
                          </button>
                          <button
                            aria-checked={mcpServerDraft.transport === "remote"}
                            className={
                              mcpServerDraft.transport === "remote"
                                ? "mcp-transport-segment is-active"
                                : "mcp-transport-segment"
                            }
                            disabled={isConnectorMcpServer}
                            role="radio"
                            type="button"
                            onClick={() => onMcpServerDraftChange("transport", "remote")}
                          >
                            流式 HTTP
                          </button>
                          {isConnectorMcpServer ? (
                            <button
                              aria-checked="true"
                              className="mcp-transport-segment is-active"
                              disabled
                              role="radio"
                              type="button"
                            >
                              CONNECTOR
                            </button>
                          ) : null}
                        </div>
                      </div>

                      <label className="settings-field">
                        <span className="settings-field-label">Timeout (ms)</span>
                        <input
                          aria-label="MCP server timeout"
                          type="text"
                          value={mcpServerDraft.timeoutMs}
                          placeholder="Optional"
                          onChange={(event) => onMcpServerDraftChange("timeoutMs", event.target.value)}
                        />
                      </label>

                      <label className="settings-field settings-checkbox-field mcp-enabled-field">
                        <span className="settings-field-label">Enabled</span>
                        <input
                          aria-label="Enable MCP server"
                          checked={mcpServerDraft.enabled}
                          type="checkbox"
                          onChange={(event) => onMcpServerDraftChange("enabled", event.target.checked)}
                        />
                      </label>
                    </div>
                  </section>

                  {mcpServerDraft.transport === "stdio" ? (
                    <section className="mcp-config-card" aria-labelledby="mcp-local-runtime-title">
                      <div className="mcp-config-card-header">
                        <h3 id="mcp-local-runtime-title">Command</h3>
                      </div>

                      <div className="mcp-editor-stack">
                        <div className="mcp-editor-section">
                          <h3>Launch command</h3>
                          <input
                            aria-label="MCP server command"
                            type="text"
                            value={mcpServerDraft.command}
                            placeholder="npx"
                            onChange={(event) => onMcpServerDraftChange("command", event.target.value)}
                          />
                        </div>

                        <LineListEditor
                          addLabel="Add argument"
                          label="Arguments"
                          placeholder="--app"
                          value={mcpServerDraft.args}
                          onChange={(value) => onMcpServerDraftChange("args", value)}
                        />

                        <KeyValueEditor
                          addLabel="Add environment variable"
                          keyPlaceholder="KEY"
                          label="Environment"
                          value={mcpServerDraft.env}
                          valuePlaceholder="VALUE"
                          onChange={(value) => onMcpServerDraftChange("env", value)}
                        />

                        <div className="mcp-editor-section">
                          <h3>Working directory</h3>
                          <input
                            aria-label="MCP server working directory"
                            type="text"
                            value={mcpServerDraft.cwd}
                            placeholder="Optional, e.g. ~/code"
                            onChange={(event) => onMcpServerDraftChange("cwd", event.target.value)}
                          />
                        </div>
                      </div>
                    </section>
                  ) : mcpServerDraft.transport === "remote" ? (
                    <section className="mcp-config-card" aria-labelledby="mcp-remote-runtime-title">
                      <div className="mcp-config-card-header">
                        <h3 id="mcp-remote-runtime-title">HTTP</h3>
                      </div>

                      <div className="mcp-editor-stack">
                        <div className="mcp-editor-section">
                          <h3>Server URL</h3>
                          <input
                            aria-label="MCP server URL"
                            type="text"
                            value={mcpServerDraft.serverUrl}
                            placeholder="https://mcp.example.com"
                            onChange={(event) => onMcpServerDraftChange("serverUrl", event.target.value)}
                          />
                        </div>

                        <div className="mcp-editor-section">
                          <h3>Authorization</h3>
                          <input
                            aria-label="MCP authorization"
                            type="text"
                            value={mcpServerDraft.authorization}
                            placeholder="Optional Authorization header value"
                            onChange={(event) => onMcpServerDraftChange("authorization", event.target.value)}
                          />
                        </div>

                        <KeyValueEditor
                          addLabel="Add header"
                          keyPlaceholder="Header"
                          label="Headers"
                          value={mcpServerDraft.headers}
                          valuePlaceholder="Value"
                          onChange={(value) => onMcpServerDraftChange("headers", value)}
                        />

                        <div className="mcp-editor-section">
                          <h3>Allowed tools</h3>
                          <select
                            aria-label="MCP allowed tools mode"
                            value={mcpServerDraft.allowedToolsMode}
                            onChange={(event) => onMcpServerDraftChange("allowedToolsMode", event.target.value)}
                          >
                            <option value="all">All tools</option>
                            <option value="names">Named tools only</option>
                            <option value="read-only">Read-only tools</option>
                            <option value="read-only-names">Read-only named tools</option>
                          </select>
                        </div>

                        {mcpServerDraft.allowedToolsMode === "names" || mcpServerDraft.allowedToolsMode === "read-only-names" ? (
                          <LineListEditor
                            addLabel="Add tool name"
                            label="Allowed tool names"
                            placeholder="tool_name"
                            value={mcpServerDraft.allowedToolNames}
                            onChange={(value) => onMcpServerDraftChange("allowedToolNames", value)}
                          />
                        ) : null}
                      </div>
                    </section>
                  ) : (
                    <section className="mcp-config-card" aria-labelledby="mcp-connector-runtime-title">
                      <div className="mcp-config-card-header">
                        <h3 id="mcp-connector-runtime-title">Connector</h3>
                      </div>

                      <div className="mcp-editor-stack">
                        <div className="mcp-editor-section">
                          <h3>Connector ID</h3>
                          <input
                            aria-label="MCP connector id"
                            type="text"
                            value={mcpServerDraft.connectorId}
                            readOnly
                          />
                        </div>
                        <p className="settings-helper-text">
                          This MCP server is generated by a connector. Manage sign-in and diagnostics from the connector or plugin page.
                        </p>
                      </div>
                    </section>
                  )}

                  {activeMcpServerDiagnostic?.ok ? (
                    <section className="mcp-config-card mcp-tool-policy-card-shell">
                      <McpToolsPolicyPanel
                        diagnostic={activeMcpServerDiagnostic}
                        draft={mcpServerDraft}
                        onPolicyChange={onMcpToolPolicyChange}
                      />
                    </section>
                  ) : null}

                  <div className="settings-actions-row mcp-server-form-footer">
                    {mcpServerValidationError ? <span className="settings-helper-text">{mcpServerValidationError}</span> : null}
                    <div className="settings-inline-actions mcp-server-form-actions">
                      <button
                        className="mcp-action-button is-secondary"
                        disabled={mcpServerBusy || isImportingMcpConfigJson}
                        onClick={() => setIsImportDialogOpen(true)}
                        type="button"
                      >
                        <DownloadIcon />
                        {t("mcp.importJson")}
                      </button>
                      {activeMcpServer ? (
                        <button
                          className="mcp-action-button is-danger"
                          disabled={mcpServerBusy}
                          onClick={() => void onDeleteMcpServer(activeMcpServer.id)}
                          type="button"
                        >
                          {deletingMcpServerID === activeMcpServer.id ? t("app.removing") : t("plugins.remove")}
                        </button>
                      ) : null}
                      <button
                        className="mcp-action-button is-primary"
                        disabled={mcpServerBusy || !mcpServerCanSave}
                        onClick={() => void onSaveMcpServer()}
                        type="button"
                      >
                        {savingMcpServerID === (activeMcpServerID ?? mcpServerDraft.id.trim()) ? t("app.saving") : t("app.save")}
                      </button>
                    </div>
                  </div>
                </main>
              </div>
            </div>
          </section>
        )}
      </div>

      {isImportDialogOpen ? (
        <div className="mcp-config-import-overlay">
          <section
            className="mcp-config-import-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mcp-config-import-title"
          >
            <div className="mcp-config-import-header">
              <div>
                <span className="label">{t("mcp.importJson")}</span>
                <h3 id="mcp-config-import-title">Install from MCP JSON</h3>
                <p className="settings-page-copy">
                  Paste a Cursor, Claude Desktop, or Claude Code MCP JSON configuration.
                </p>
              </div>
              <button
                className="settings-page-close-button"
                type="button"
                aria-label="Close MCP JSON import"
                onClick={() => setIsImportDialogOpen(false)}
              >
                <CloseIcon />
              </button>
            </div>

            <details className="mcp-config-import-example">
              <summary>View example</summary>
              <pre>{MCP_CONFIG_IMPORT_EXAMPLE}</pre>
            </details>

            <label className="settings-field">
              <span className="settings-field-label">MCP configuration JSON</span>
              <textarea
                aria-label="MCP configuration JSON"
                rows={12}
                value={importConfigJson}
                placeholder="Paste MCP configuration JSON..."
                onChange={(event) => setImportConfigJson(event.target.value)}
              />
            </label>

            {importPreview ? (
              importPreview.tone === "success" ? (
                <div className="settings-banner is-success">
                  Detected {importServerCount} MCP server{importServerCount === 1 ? "" : "s"}:{" "}
                  {importPreview.result.servers.map((server) => server.id).join(", ")}
                </div>
              ) : (
                <div className="settings-banner is-error">{importPreview.errorMessage}</div>
              )
            ) : null}

            {importPreview?.tone === "success" && importPreview.result.warnings.length > 0 ? (
              <div className="mcp-config-import-warnings">
                {importPreview.result.warnings.map((warning) => (
                  <span key={warning}>{warning}</span>
                ))}
              </div>
            ) : null}

            <div className="settings-inline-actions mcp-config-import-actions">
              <button
                className="mcp-action-button is-secondary"
                type="button"
                disabled={isImportingMcpConfigJson}
                onClick={() => setIsImportDialogOpen(false)}
              >
                {t("app.cancel")}
              </button>
              <button
                className="mcp-action-button is-primary"
                type="button"
                disabled={!canImportConfigJson}
                onClick={() => void handleImportConfigJson()}
              >
                {isImportingMcpConfigJson ? t("app.importing") : t("mcp.importJson")}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  )
}
