import { useLayoutEffect, useMemo, useState, type ReactNode } from "react"
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
  ConnectorDefinition,
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
  filterMcpInventoryServers,
  getMcpServerPluginSource,
  getMcpServerPresentationSource,
  type McpServerPresentationSource,
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
  connectorCatalog?: ConnectorDefinition[]
  diagnosingMcpServerID?: string | null
  installedPlugins?: InstalledPlugin[]
  pluginCatalog?: PluginCatalogItem[]
  savingMcpServerID: string | null
  hideNavigator?: boolean
  hideTopMenu?: boolean
  isImportingMcpConfigJson?: boolean
  searchQuery?: string
  windowControls?: ReactNode
  onDeleteMcpServer: (serverID: string) => void | Promise<void>
  onDiagnoseMcpServer: (serverID: string) => boolean | Promise<boolean>
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
  connectorCatalog?: ConnectorDefinition[]
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

function getMcpServerLookupText(
  server: McpServerSummary,
  source?: McpServerPresentationSource,
) {
  return [
    server.id,
    server.name ?? "",
    server.transport,
    server.transport === "stdio" ? server.command : server.transport === "remote" ? server.serverUrl ?? "" : server.connectorId,
    server.transport === "stdio" ? server.args?.join(" ") ?? "" : server.serverDescription ?? "",
    source?.searchText ?? "",
  ].join(" ").toLowerCase()
}

interface McpServerVisualProfile {
  category: string
  displayName: string
}

function getMcpServerVisualProfile(
  server: McpServerSummary,
  source?: McpServerPresentationSource,
): McpServerVisualProfile {
  const lookupText = getMcpServerLookupText(server, source)
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
    const detail = diagnostic.error?.trim()
    if (!detail) {
      return "Tool discovery failed, so the available capabilities are unknown."
    }

    const uvxRecovery = /No module named ['\"]mcp\.server\.fastmcp['\"]/.test(detail)
      ? " This server expects the MCP Python SDK 1.x. With uvx, add '--with' and 'mcp<2' as separate arguments before the executable name."
      : ""

    return `Tool discovery failed: ${detail}${uvxRecovery}`
  }

  if (activeMcpServer.transport === "stdio") {
    return `Runs a local MCP process with ${activeMcpServer.command || "a configured command"} to add tools to the assistant.`
  }

  return "Connects to a remote MCP endpoint to add external tools to the assistant."
}

function getManagedMcpHelperText(source: McpServerPresentationSource | null) {
  if (source?.kind === "anybox") {
    return "This MCP server is built into Anybox. Its runtime configuration is read-only; enablement and tool permissions can be changed here."
  }

  if (source?.kind === "connector") {
    return "This MCP server is generated by an account connector. Manage authentication in Connectors; enablement and tool permissions can be changed here."
  }

  if (source?.kind === "plugin") {
    return "This MCP server is generated by a plugin. Manage its connection in Plugins; enablement and tool permissions can be changed here."
  }

  return "This MCP server is managed by Anybox. Its runtime configuration is read-only; enablement and tool permissions can be changed here."
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
  source: McpServerPresentationSource,
) {
  const query = rawQuery.trim().toLowerCase()
  if (!query) return true

  const haystack = [
    server.id,
    server.name ?? "",
    getMcpTransportLabel(server.transport),
    server.enabled ? "enabled" : "disabled",
    server.transport === "stdio" ? server.command ?? "" : server.transport === "remote" ? server.serverUrl ?? "" : server.connectorId,
    source.searchText,
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

  if (draft.transport === "remote" && !draft.serverUrl.trim() && !draft.connectorId.trim()) {
    return "Remote MCP servers require a server URL or connector id."
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
  source: McpServerPresentationSource | null
}

function McpServerOverviewCard({
  activeMcpServer,
  diagnostic,
  source,
}: McpServerOverviewCardProps) {
  if (!activeMcpServer) return null

  const visualProfile = getMcpServerVisualProfile(activeMcpServer, source ?? undefined)
  const hasDiagnosticFailure = Boolean(diagnostic && !diagnostic.ok)

  return (
    <section className="mcp-overview-card" aria-labelledby="mcp-overview-title">
      <div className="mcp-overview-header">
        <div className="mcp-overview-identity">
          <div className="mcp-overview-copy">
            <div className="mcp-overview-label-row">
              <span className="label">{visualProfile.category}</span>
              {source ? (
                <span
                  className={`mcp-server-source-chip is-${source.kind}`}
                  title={source.title}
                >
                  {source.title}
                </span>
              ) : null}
            </div>
            <h3 id="mcp-overview-title">{visualProfile.displayName}</h3>
            <p
              aria-live={hasDiagnosticFailure ? "polite" : undefined}
              className={hasDiagnosticFailure ? "is-error" : undefined}
            >
              {getMcpPurposeText(activeMcpServer, diagnostic)}
            </p>
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
  readOnly?: boolean
  value: string
  onChange: (value: string) => void
}

function LineListEditor({
  addLabel,
  label,
  placeholder,
  readOnly = false,
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
              readOnly={readOnly}
              onChange={(event) => updateRow(index, event.target.value)}
            />
            <button
              aria-label={`Remove ${label} ${index + 1}`}
              className="mcp-editor-remove-button"
              disabled={readOnly || (!value && rows.length === 1)}
              title="Remove"
              type="button"
              onClick={() => removeRow(index)}
            >
              <DeleteIcon />
            </button>
          </div>
        ))}
      </div>
      <button className="mcp-editor-add-button" disabled={readOnly} type="button" onClick={addRow}>
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
  readOnly?: boolean
  value: string
  valuePlaceholder: string
  onChange: (value: string) => void
}

function KeyValueEditor({
  addLabel,
  keyPlaceholder,
  label,
  readOnly = false,
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
              readOnly={readOnly}
              onChange={(event) => updateRow(index, "key", event.target.value)}
            />
            <input
              aria-label={`${label} value ${index + 1}`}
              type="text"
              value={row.value}
              placeholder={valuePlaceholder}
              readOnly={readOnly}
              onChange={(event) => updateRow(index, "value", event.target.value)}
            />
            <button
              aria-label={`Remove ${label} ${index + 1}`}
              className="mcp-editor-remove-button"
              disabled={readOnly || (!value && rows.length === 1)}
              title="Remove"
              type="button"
              onClick={() => removeRow(index)}
            >
              <DeleteIcon />
            </button>
          </div>
        ))}
      </div>
      <button className="mcp-editor-add-button" disabled={readOnly} type="button" onClick={addRow}>
        <PlusIcon />
        {addLabel}
      </button>
    </div>
  )
}

export function McpServersSidebarView({
  activeMcpServerID,
  connectorCatalog = [],
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
      getMcpServerPresentationSource(
        server,
        getMcpServerPluginSource(server, pluginSourceMap),
        connectorCatalog,
      ),
    )),
    [connectorCatalog, effectiveSearchQuery, mcpServers, pluginSourceMap],
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
            const source = getMcpServerPresentationSource(server, pluginSource, connectorCatalog)

            return (
              <button
                key={server.id}
                className={isActive ? "skill-tree-row mcp-server-sidebar-row is-active" : "skill-tree-row mcp-server-sidebar-row"}
                aria-label={`${server.name ?? server.id}${source.ariaLabel ? ` ${source.ariaLabel}` : ""} ${server.enabled ? "enabled" : "disabled"}`}
                aria-pressed={isActive}
                type="button"
                onClick={() => onMcpServerSelect(server.id)}
              >
                <span className="mcp-server-sidebar-copy">
                  <span className="mcp-server-sidebar-name">{server.name ?? server.id}</span>
                  <span
                    className={`mcp-server-sidebar-source is-${source.kind}`}
                    title={source.title}
                  >
                    {source.badge}
                  </span>
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
  connectorCatalog = [],
  deletingMcpServerID,
  diagnosingMcpServerID = null,
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
  onDiagnoseMcpServer,
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
  const mcpInventoryServers = useMemo(
    () => filterMcpInventoryServers(
      mcpServers,
      installedPlugins,
      pluginCatalog,
      connectorCatalog,
    ),
    [connectorCatalog, installedPlugins, mcpServers, pluginCatalog],
  )
  const activeMcpServer = activeMcpServerID
    ? mcpInventoryServers.find((server) => server.id === activeMcpServerID) ?? null
    : null
  const hasHiddenActiveMcpServer = Boolean(activeMcpServerID && !activeMcpServer)
  const pluginSourceMap = useMemo(
    () => buildMcpServerPluginSourceMap(installedPlugins, pluginCatalog),
    [installedPlugins, pluginCatalog],
  )
  const activeMcpServerPluginSource = activeMcpServer ? getMcpServerPluginSource(activeMcpServer, pluginSourceMap) : null
  const activeMcpServerSource = activeMcpServer
    ? getMcpServerPresentationSource(activeMcpServer, activeMcpServerPluginSource, connectorCatalog)
    : null
  const mcpServerBusyID = activeMcpServerID ?? mcpServerDraft.id.trim() ?? null
  const mcpServerBusy = Boolean(
    (mcpServerBusyID && savingMcpServerID === mcpServerBusyID) ||
    (mcpServerBusyID && deletingMcpServerID === mcpServerBusyID),
  )
  const mcpServerValidationError = getMcpServerValidationError(mcpServerDraft)
  const mcpServerCanSave = !mcpServerValidationError
  const isConnectorMcpServer = mcpServerDraft.transport === "connector"
  const isManagedMcpServer = Boolean(
    activeMcpServer
    && (
      (activeMcpServer.owner && activeMcpServer.owner.kind !== "user")
      || (!activeMcpServer.owner && activeMcpServer.transport === "connector")
    ),
  )
  const isAnyboxManagedMcpServer =
    isManagedMcpServer && activeMcpServerSource?.kind === "anybox"
  const isDiagnosingMcpServer = Boolean(
    activeMcpServerID && diagnosingMcpServerID === activeMcpServerID,
  )
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

  useLayoutEffect(() => {
    if (hasHiddenActiveMcpServer) {
      onStartNewMcpServer()
    }
  }, [hasHiddenActiveMcpServer, onStartNewMcpServer])

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
                  connectorCatalog={connectorCatalog}
                  deletingMcpServerID={deletingMcpServerID}
                  isImportingMcpConfigJson={isImportingMcpConfigJson}
                  installedPlugins={installedPlugins}
                  mcpServers={mcpInventoryServers}
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
                    source={activeMcpServerSource}
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
                          readOnly={isManagedMcpServer}
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
                          readOnly={isManagedMcpServer}
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
                            disabled={isManagedMcpServer || isConnectorMcpServer}
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
                            disabled={isManagedMcpServer || isConnectorMcpServer}
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
                              {isAnyboxManagedMcpServer ? "BUILT-IN" : "CONNECTOR"}
                            </button>
                          ) : null}
                        </div>
                      </div>

                      {isManagedMcpServer && !isConnectorMcpServer ? (
                        <p className="settings-helper-text">
                          {getManagedMcpHelperText(activeMcpServerSource)}
                        </p>
                      ) : null}

                      <label className="settings-field">
                        <span className="settings-field-label">Timeout (ms)</span>
                        <input
                          aria-label="MCP server timeout"
                          type="text"
                          value={mcpServerDraft.timeoutMs}
                          placeholder="Optional"
                          readOnly={isManagedMcpServer}
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
                          readOnly={isManagedMcpServer}
                          onChange={(event) => onMcpServerDraftChange("command", event.target.value)}
                          />
                        </div>

                        <LineListEditor
                          addLabel="Add argument"
                          label="Arguments"
                          placeholder="--app"
                          readOnly={isManagedMcpServer}
                          value={mcpServerDraft.args}
                          onChange={(value) => onMcpServerDraftChange("args", value)}
                        />

                        <KeyValueEditor
                          addLabel="Add environment variable"
                          keyPlaceholder="KEY"
                          label="Environment"
                          readOnly={isManagedMcpServer}
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
                          readOnly={isManagedMcpServer}
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
                            readOnly={isManagedMcpServer}
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
                            readOnly={isManagedMcpServer}
                            onChange={(event) => onMcpServerDraftChange("authorization", event.target.value)}
                          />
                        </div>

                        <KeyValueEditor
                          addLabel="Add header"
                          keyPlaceholder="Header"
                          label="Headers"
                          readOnly={isManagedMcpServer}
                          value={mcpServerDraft.headers}
                          valuePlaceholder="Value"
                          onChange={(value) => onMcpServerDraftChange("headers", value)}
                        />

                        <div className="mcp-editor-section">
                          <h3>Allowed tools</h3>
                          <select
                            aria-label="MCP allowed tools mode"
                            disabled={isManagedMcpServer}
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
                            readOnly={isManagedMcpServer}
                            value={mcpServerDraft.allowedToolNames}
                            onChange={(value) => onMcpServerDraftChange("allowedToolNames", value)}
                          />
                        ) : null}
                      </div>
                    </section>
                  ) : (
                    <section className="mcp-config-card" aria-labelledby="mcp-connector-runtime-title">
                      <div className="mcp-config-card-header">
                        <h3 id="mcp-connector-runtime-title">
                          {isAnyboxManagedMcpServer ? "Managed runtime" : "Connector"}
                        </h3>
                      </div>

                      <div className="mcp-editor-stack">
                        <div className="mcp-editor-section">
                          <h3>{isAnyboxManagedMcpServer ? "Runtime ID" : "Connector ID"}</h3>
                          <input
                            aria-label={isAnyboxManagedMcpServer ? "MCP managed runtime id" : "MCP connector id"}
                            type="text"
                            value={mcpServerDraft.connectorId}
                            readOnly
                          />
                        </div>
                        <p className="settings-helper-text">
                          {getManagedMcpHelperText(activeMcpServerSource)}
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
                      {activeMcpServer && !isManagedMcpServer ? (
                        <button
                          className="mcp-action-button is-danger"
                          disabled={mcpServerBusy}
                          onClick={() => void onDeleteMcpServer(activeMcpServer.id)}
                          type="button"
                        >
                          {deletingMcpServerID === activeMcpServer.id ? t("app.removing") : t("plugins.remove")}
                        </button>
                      ) : null}
                      {activeMcpServer ? (
                        <button
                          className="mcp-action-button is-secondary"
                          disabled={mcpServerBusy || isDiagnosingMcpServer}
                          onClick={() => void onDiagnoseMcpServer(activeMcpServer.id)}
                          type="button"
                        >
                          {isDiagnosingMcpServer ? "Checking..." : "Diagnose"}
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
