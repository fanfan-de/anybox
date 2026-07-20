import type { InstalledPlugin, PluginCatalogItem } from "./types"

function normalizePluginID(pluginID: string) {
  return pluginID.trim().toLowerCase()
}

export function installedPluginDisplayName(pluginID: string) {
  const words = pluginID
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean)

  if (words.length === 0) return "Installed Plugin"

  return words
    .map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
    .join(" ")
}

export function buildInstalledPluginCatalogFallback(installed: InstalledPlugin): PluginCatalogItem {
  const name = installedPluginDisplayName(installed.pluginID)
  const description = installed.missingPackage
    ? "Installed record is present, but the plugin package is missing."
    : "Installed plugin package available on this device."

  return {
    id: installed.pluginID,
    name,
    description,
    longDescription: `${description} Catalog metadata is unavailable, so only local installation details can be shown.`,
    version: installed.version,
    publisher: "Local",
    category: "Automation",
    icon: "P",
    screenshots: [],
    tags: ["installed"],
    risk: "low",
    permissions: [],
    tools: [],
    configFields: [],
    mcpServers: [],
    mcpRequirements: [],
    skills: [],
    connectorRequirements: [],
    connectors: [],
    apps: [],
    source: "package",
    installable: false,
  }
}

export function mergePluginCatalogWithInstalled(
  catalog: PluginCatalogItem[],
  installedPlugins: InstalledPlugin[],
) {
  const catalogIDs = new Set(catalog.map((plugin) => normalizePluginID(plugin.id)))
  const missingInstalledPlugins = installedPlugins.filter((plugin) => !catalogIDs.has(normalizePluginID(plugin.pluginID)))

  if (missingInstalledPlugins.length === 0) return catalog

  return [
    ...catalog,
    ...missingInstalledPlugins.map(buildInstalledPluginCatalogFallback),
  ]
}

export function pluginCatalogSignature(items: PluginCatalogItem[]) {
  return JSON.stringify(items)
}

export function arePluginCatalogsEqual(left: PluginCatalogItem[], right: PluginCatalogItem[]) {
  return pluginCatalogSignature(left) === pluginCatalogSignature(right)
}
