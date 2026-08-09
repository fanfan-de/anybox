export const LOCAL_PREVIEW_PROTOCOL = "anybox-preview"
export const PLUGIN_VIEW_PARTITION_PREFIX = "plugin-view:"

export function toPluginViewPartition(pluginID: string) {
  const normalizedPluginID = pluginID.trim()
  if (!normalizedPluginID) {
    throw new Error("Plugin View partition requires a plugin ID.")
  }
  return `${PLUGIN_VIEW_PARTITION_PREFIX}${encodeURIComponent(normalizedPluginID)}`
}

export function toLocalPreviewProtocolUrl(token: string, relativePath: string) {
  const normalizedPath = relativePath.replace(/\\/g, "/").replace(/^\/+/, "")
  const encodedPath = normalizedPath
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/")

  return `${LOCAL_PREVIEW_PROTOCOL}://preview/${encodeURIComponent(token)}${encodedPath ? `/${encodedPath}` : ""}`
}
