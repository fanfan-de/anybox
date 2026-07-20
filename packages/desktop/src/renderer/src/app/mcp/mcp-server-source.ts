import type {
  ConnectorDefinition,
  InstalledPlugin,
  McpServerSummary,
  PluginCatalogItem,
} from "../types"

export interface McpServerPluginSource {
  pluginID: string
  pluginName?: string
}

export type McpServerPresentationSourceKind = "anybox" | "connector" | "managed" | "plugin" | "custom"

export interface McpServerPresentationSource {
  ariaLabel: string | null
  badge: string
  kind: McpServerPresentationSourceKind
  searchText: string
  title: string
}

function normalizePluginID(pluginID: string) {
  return pluginID.trim().toLowerCase()
}

export function buildMcpServerPluginSourceMap(
  installedPlugins: InstalledPlugin[] = [],
  pluginCatalog: PluginCatalogItem[] = [],
) {
  const pluginNamesByID = new Map(pluginCatalog.map((plugin) => [normalizePluginID(plugin.id), plugin.name]))
  const sourcesByServerID = new Map<string, McpServerPluginSource>()

  for (const installedPlugin of installedPlugins) {
    const normalizedPluginID = normalizePluginID(installedPlugin.pluginID)
    const source: McpServerPluginSource = {
      pluginID: installedPlugin.pluginID,
      pluginName: pluginNamesByID.get(normalizedPluginID) ?? installedPlugin.pluginID,
    }
    const serverIDs = new Set([
      installedPlugin.mcpServerID,
      ...installedPlugin.mcpServerIDs,
    ].filter((serverID): serverID is string => Boolean(serverID)))

    for (const serverID of serverIDs) {
      sourcesByServerID.set(serverID, source)
    }
  }

  return sourcesByServerID
}

export function getMcpServerPluginSource(
  server: McpServerSummary,
  sourcesByServerID: ReadonlyMap<string, McpServerPluginSource>,
): McpServerPluginSource | null {
  if (server.owner?.kind === "plugin") {
    const normalizedOwnerPluginID = normalizePluginID(server.owner.pluginID)
    const installedSource = [...sourcesByServerID.values()].find(
      (source) => normalizePluginID(source.pluginID) === normalizedOwnerPluginID,
    )
    return installedSource ?? { pluginID: server.owner.pluginID }
  }

  if (server.owner) return null

  return sourcesByServerID.get(server.id) ?? null
}

export function getMcpServerPluginSourceTitle(source: McpServerPluginSource) {
  const pluginName = source.pluginName?.trim()
  return pluginName ? `From plugin: ${pluginName}` : "From plugin"
}

export function getMcpServerPluginSourceAriaLabel(source: McpServerPluginSource) {
  const pluginName = source.pluginName?.trim()
  return pluginName ? `from plugin ${pluginName}` : "from plugin"
}

export function getMcpServerPluginSourceSearchText(source: McpServerPluginSource | null) {
  if (!source) return ""

  return [
    "plugin",
    "from plugin",
    source.pluginID,
    source.pluginName ?? "",
  ].join(" ")
}

function getPlatformConnectorDefinition(
  server: McpServerSummary,
  connectorCatalog: ConnectorDefinition[],
) {
  if (server.owner?.kind === "anybox") {
    const bindingID = server.owner.bindingID
    const bindingDefinition = connectorCatalog.find(
      (definition) => definition.id === bindingID,
    )
    if (bindingDefinition) return bindingDefinition
  }

  const connectorID = server.owner?.kind === "connector"
    ? server.owner.connectorId
    : server.transport === "connector"
      ? server.connectorId
      : server.transport === "remote"
        ? server.connectorId
        : undefined
  if (!connectorID?.startsWith("connector:")) return null

  const definitionID = connectorID.slice("connector:".length).split(":")[0]?.trim()
  if (!definitionID) return null

  return connectorCatalog.find((definition) => definition.id === definitionID) ?? null
}

export function getMcpServerPresentationSource(
  server: McpServerSummary,
  pluginSource: McpServerPluginSource | null,
  connectorCatalog: ConnectorDefinition[] = [],
): McpServerPresentationSource {
  if (server.owner?.kind === "anybox") {
    const connectorDefinition = getPlatformConnectorDefinition(server, connectorCatalog)
    return {
      ariaLabel: "built into Anybox",
      badge: "Anybox",
      kind: "anybox",
      searchText: [
        "anybox",
        "built-in",
        server.owner.bindingID,
        server.name ?? "",
        connectorDefinition?.id ?? "",
        connectorDefinition?.name ?? "",
      ].join(" "),
      title: connectorDefinition
        ? `Built into Anybox: ${connectorDefinition.name}`
        : server.name
          ? `Built into Anybox: ${server.name}`
          : "Built into Anybox",
    }
  }

  if (server.owner?.kind === "connector") {
    const connectorDefinition = getPlatformConnectorDefinition(server, connectorCatalog)
    const connectorName = connectorDefinition?.name ?? server.owner.connectorId
    return {
      ariaLabel: `from connector ${connectorName}`,
      badge: "Connector",
      kind: "connector",
      searchText: [
        "connector",
        server.owner.connectorId,
        server.owner.runtimeID,
        connectorDefinition?.id ?? "",
        connectorDefinition?.name ?? "",
        connectorDefinition?.publisher ?? "",
      ].join(" "),
      title: `From connector: ${connectorName}`,
    }
  }

  if (server.owner?.kind === "user") {
    return {
      ariaLabel: null,
      badge: "Custom",
      kind: "custom",
      searchText: "custom user configured",
      title: "Custom MCP server",
    }
  }

  if (server.owner?.kind === "plugin") {
    const source = pluginSource ?? { pluginID: server.owner.pluginID }
    const pluginName = source.pluginName?.trim()
    return {
      ariaLabel: pluginName ? `from plugin ${pluginName}` : "from plugin",
      badge: "Plugin",
      kind: "plugin",
      searchText: getMcpServerPluginSourceSearchText(source),
      title: getMcpServerPluginSourceTitle(source),
    }
  }

  if (pluginSource) {
    const pluginName = pluginSource.pluginName?.trim()
    return {
      ariaLabel: pluginName ? `from plugin ${pluginName}` : "from plugin",
      badge: "Plugin",
      kind: "plugin",
      searchText: getMcpServerPluginSourceSearchText(pluginSource),
      title: getMcpServerPluginSourceTitle(pluginSource),
    }
  }

  const connectorDefinition = getPlatformConnectorDefinition(server, connectorCatalog)
  if (connectorDefinition) {
    return {
      ariaLabel: `from connector ${connectorDefinition.name}`,
      badge: "Connector",
      kind: "connector",
      searchText: [
        "connector",
        connectorDefinition.id,
        connectorDefinition.name,
        connectorDefinition.publisher,
      ].join(" "),
      title: `From connector: ${connectorDefinition.name}`,
    }
  }

  if (
    server.transport === "connector"
    || (server.transport === "remote" && Boolean(server.connectorId))
  ) {
    return {
      ariaLabel: "managed MCP server",
      badge: "Managed",
      kind: "managed",
      searchText: "managed connector",
      title: "Managed MCP server",
    }
  }

  return {
    ariaLabel: null,
    badge: "Custom",
    kind: "custom",
    searchText: "custom user configured",
    title: "Custom MCP server",
  }
}

export function filterMcpInventoryServers(
  servers: McpServerSummary[],
  installedPlugins: InstalledPlugin[] = [],
  pluginCatalog: PluginCatalogItem[] = [],
  connectorCatalog: ConnectorDefinition[] = [],
) {
  // Management follows product ownership: plugin and account-connector MCP
  // stays with its owner; standalone and Anybox built-in MCP stays here.
  const pluginSourceMap = buildMcpServerPluginSourceMap(installedPlugins, pluginCatalog)

  return servers.filter((server) => {
    const pluginSource = getMcpServerPluginSource(server, pluginSourceMap)
    const sourceKind = getMcpServerPresentationSource(server, pluginSource, connectorCatalog).kind
    return sourceKind === "anybox" || sourceKind === "custom"
  })
}
