import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react"
import { createPortal } from "react-dom"
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ConnectedStatusIcon,
  DeleteIcon,
  FolderOpenIcon,
  OpenExternalIcon,
  PluginIcon,
  PlusIcon,
  SettingsIcon,
} from "../icons"
import { ShellTopMenu } from "../shared-ui"
import { installedPluginDisplayName } from "../plugin-catalog"
import type {
  ConnectorStatus,
  InstalledPlugin,
  McpServerDiagnostic,
  PluginCatalogItem,
  PluginCategory,
  PluginConnectorStatus,
  PluginDraftState,
  PluginRuntimeTemplate,
} from "../types"

interface PluginsPageProps {
  activePluginID: string | null
  deletingPluginID: string | null
  diagnosingPluginConnectorID: string | null
  diagnosingPluginID: string | null
  installingPluginID: string | null
  installedPlugins: InstalledPlugin[]
  isLoading: boolean
  loadError: string | null
  connectorStatuses: ConnectorStatus[]
  pluginCatalog: PluginCatalogItem[]
  pluginConnectorStatuses: Record<string, PluginConnectorStatus[]>
  pluginDiagnostics: Record<string, McpServerDiagnostic>
  pluginDraft: PluginDraftState
  savingPluginConnectorID: string | null
  hideTopMenu?: boolean
  searchQuery?: string
  updatingPluginID: string | null
  windowControls?: ReactNode
  onDeleteInstalledPlugin: (pluginID: string) => boolean | Promise<boolean>
  onCancelInstalledPluginConnectorAuthFlow: (pluginID: string, appID: string) => boolean | Promise<boolean>
  onDeleteInstalledPluginConnectorApiKey: (pluginID: string, appID: string) => boolean | Promise<boolean>
  onDeleteInstalledPluginConnectorAuthSession: (pluginID: string, appID: string) => boolean | Promise<boolean>
  onDiagnoseInstalledPlugin: (pluginID: string) => boolean | Promise<boolean>
  onDiagnoseInstalledPluginConnector: (pluginID: string, appID: string) => boolean | Promise<boolean>
  onInstallPlugin: (pluginID: string) => boolean | Promise<boolean>
  onPluginDraftAppApiKeyChange: (appID: string, value: string) => void
  onPluginDraftConfigChange: (key: string, value: string) => void
  onPluginDeselect: () => void
  onPluginSelect: (pluginID: string) => void
  onSaveInstalledPluginConnectorApiKey: (pluginID: string, appID: string) => boolean | Promise<boolean>
  onSaveInstalledPluginConfig: (pluginID: string) => boolean | Promise<boolean>
  onSearchQueryChange?: (value: string) => void
  onSetInstalledPluginEnabled: (pluginID: string, enabled: boolean) => boolean | Promise<boolean>
  onStartInstalledPluginConnectorAuthFlow: (pluginID: string, appID: string) => boolean | Promise<boolean>
}

const CATEGORY_FILTERS: Array<PluginCategory | "All"> = [
  "All",
  "Code",
  "Browser",
  "Git",
  "Database",
  "Docs",
  "Automation",
  "Design",
]

const CATEGORY_LABELS: Record<PluginCategory | "All", string> = {
  All: "全部",
  Code: "开发",
  Browser: "Browser",
  Git: "Git",
  Database: "数据",
  Docs: "文档",
  Automation: "自动化",
  Design: "设计",
}

const FEATURED_PLUGIN_LIMIT = 3

type PluginVisualStyle = CSSProperties & {
  "--plugins-brand-color"?: string
}

function runtimeTitle(runtime: PluginRuntimeTemplate) {
  if (runtime.transport === "stdio") {
    return "stdio command"
  }

  return "remote endpoint"
}

function runtimePrimary(runtime: PluginRuntimeTemplate) {
  if (runtime.transport === "stdio") {
    return [runtime.command, ...(runtime.args ?? [])].join(" ")
  }

  return runtime.serverUrl ?? runtime.connectorId ?? "Remote MCP"
}

function runtimeSecondary(runtime: PluginRuntimeTemplate) {
  if (runtime.transport === "stdio") {
    const envKeys = Object.keys(runtime.env ?? {})
    return envKeys.length > 0 ? `env: ${envKeys.join(", ")}` : "no required env keys"
  }

  const headerKeys = Object.keys(runtime.headers ?? {})
  return headerKeys.length > 0 ? `headers: ${headerKeys.join(", ")}` : "no required headers"
}

function generatedServerID(plugin: PluginCatalogItem, server: PluginCatalogItem["mcpServers"][number]) {
  return server.id === "default" ? `plugin.${plugin.id}` : `plugin.${plugin.id}.${server.id}`
}

function toolSummary(tools?: Array<{ name: string; title?: string }>) {
  if (!tools?.length) return "No static tools declared"
  return tools.map((tool) => tool.title ?? tool.name).join(", ")
}

function permissionSummary(permissions?: string[]) {
  return permissions?.length ? permissions.join(", ") : "No extra permissions declared"
}

function credentialKindLabel(kind: "api_key" | "oauth" | undefined) {
  return kind === "oauth" ? "OAuth" : "API key"
}

function pluginConfigInputType(field: PluginCatalogItem["configFields"][number]) {
  if (field.secret || field.type === "password") return "password"
  if (field.type === "url") return "url"
  return "text"
}

function connectorStatusLabel(status: ConnectorStatus | PluginConnectorStatus | undefined) {
  if (!status) return "Not connected"
  if (status.authStatus === "pending") return "Signing in"
  if (status.authStatus === "expired") return "Expired"
  if (status.authStatus === "error") return "Error"
  return status.connected ? "Connected" : "Not connected"
}

function openPluginExternalUrl(url: string) {
  const normalizedUrl = url.trim()
  if (!normalizedUrl) return

  const openExternalUrl = window.desktop?.openExternalUrl
  if (openExternalUrl) {
    void openExternalUrl({ url: normalizedUrl }).catch((error) => {
      console.error("[plugins] Failed to open external URL.", error)
      window.open(normalizedUrl, "_blank", "noopener,noreferrer")
    })
    return
  }

  window.open(normalizedUrl, "_blank", "noopener,noreferrer")
}

function handlePluginInfoLinkClick(event: MouseEvent<HTMLAnchorElement>, url: string) {
  if (event.defaultPrevented) return
  event.preventDefault()
  openPluginExternalUrl(url)
}

function categoryClassName(category: PluginCategory) {
  return `is-${category.toLowerCase()}`
}

function pluginInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return "P"
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase()
}

function pluginImageURL(plugin: PluginCatalogItem, kind: "icon" | "thumbnail" | "hero") {
  if (kind === "icon") return plugin.iconUrl ?? (plugin.icon && isImageIcon(plugin.icon) ? plugin.icon : undefined)
  if (kind === "thumbnail") return plugin.thumbnailUrl ?? plugin.heroImageUrl ?? plugin.screenshots?.[0]
  return plugin.heroImageUrl ?? plugin.thumbnailUrl ?? plugin.screenshots?.[0]
}

function pluginBrandColor(plugin: PluginCatalogItem) {
  const color = plugin.brandColor?.trim()
  return color && /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color) ? color : undefined
}

function pluginBrandStyle(plugin: PluginCatalogItem): PluginVisualStyle | undefined {
  const color = pluginBrandColor(plugin)
  return color ? { "--plugins-brand-color": color } : undefined
}

function pluginCapabilityCount(plugin: PluginCatalogItem) {
  return plugin.mcpServers.length + plugin.skills.length + plugin.connectorRequirements.length + plugin.apps.length
}

function pluginCapabilityLabel(plugin: PluginCatalogItem) {
  const count = pluginCapabilityCount(plugin)
  if (count > 0) return `${count} 项能力`
  if (plugin.tools.length > 0) return `${plugin.tools.length} 个工具`
  return "基础插件"
}

function pluginStoreSourceLabel(plugin: PluginCatalogItem) {
  if (plugin.source === "package") return "本地包"
  if (plugin.source === "registry") return "Registry"
  return "Catalog"
}

function pluginDetailDescription(plugin: PluginCatalogItem) {
  if (plugin.longDescription?.trim()) return plugin.longDescription.trim()

  const capabilityCount = plugin.mcpServers.length + plugin.skills.length + plugin.connectorRequirements.length + plugin.apps.length
  const capabilityLabel = capabilityCount === 1 ? "capability" : "capabilities"

  return `${plugin.description} This plugin includes ${capabilityCount} ${capabilityLabel} for ${plugin.category.toLowerCase()} workflows and can be enabled per project after installation.`
}

function pluginFunctionLabel(plugin: PluginCatalogItem) {
  const toolModes = new Set<string>(plugin.tools.map((tool) => (tool.readOnly ? "Read" : "Write")))
  if (plugin.connectorRequirements.length + plugin.apps.length > 0) toolModes.add("Interactive")
  if (plugin.mcpServers.length > 0) toolModes.add("MCP")
  if (toolModes.size === 0) toolModes.add(plugin.category)

  return Array.from(toolModes).join(", ")
}

function isImageIcon(icon: string) {
  return /^(https?:\/\/|data:image\/)/.test(icon)
}

function PluginMark({ plugin }: { plugin: PluginCatalogItem }) {
  const icon = pluginImageURL(plugin, "icon") ?? plugin.icon?.trim()

  return (
    <span className={`plugins-icon-mark ${categoryClassName(plugin.category)}`} aria-hidden="true">
      {icon && isImageIcon(icon) ? (
        <img src={icon} alt="" />
      ) : icon && icon.length <= 4 ? (
        <span className="plugins-icon-glyph">{icon}</span>
      ) : (
        <span className="plugins-icon-initials">{pluginInitials(plugin.name)}</span>
      )}
    </span>
  )
}

interface PluginCategoryNavigationProps {
  activeCategory: PluginCategory | "All"
  categoryCounts: Map<PluginCategory | "All", number>
  onCategoryChange: (category: PluginCategory | "All") => void
}

function PluginCategoryNavigation({
  activeCategory,
  categoryCounts,
  onCategoryChange,
}: PluginCategoryNavigationProps) {
  return (
    <nav className="plugins-marketplace-category-nav" aria-label="Plugin categories">
      {CATEGORY_FILTERS.map((category) => {
        const isActive = category === activeCategory
        const count = categoryCounts.get(category) ?? 0

        return (
          <button
            key={category}
            className={isActive ? "is-active" : undefined}
            type="button"
            aria-label={`${CATEGORY_LABELS[category]}，${count} 个插件`}
            aria-pressed={isActive}
            onClick={() => onCategoryChange(category)}
          >
            <span>{CATEGORY_LABELS[category]}</span>
            <span>{count}</span>
          </button>
        )
      })}
    </nav>
  )
}

interface PluginMarketItemProps {
  canInstall: boolean
  installed: InstalledPlugin | null
  isActive: boolean
  isBusy: boolean
  plugin: PluginCatalogItem
  onInstallPlugin: (pluginID: string) => boolean | Promise<boolean>
  onPluginSelect: (pluginID: string) => void
}

function PluginMarketItem({
  canInstall,
  installed,
  isActive,
  isBusy,
  plugin,
  onInstallPlugin,
  onPluginSelect,
}: PluginMarketItemProps) {
  const packageMissing = Boolean(installed?.missingPackage)
  const installState = packageMissing
    ? "package missing"
    : installed ? (installed.enabled ? "installed enabled" : "installed disabled") : "not installed"
  const visibleStatus = packageMissing ? "需重新下载" : installed ? (installed.enabled ? "已安装" : "已停用") : null
  const tags = plugin.tags.slice(0, 2)
  const sourceLabel = pluginStoreSourceLabel(plugin)

  return (
    <div
      className={isActive ? "plugins-market-item is-active" : "plugins-market-item"}
      style={pluginBrandStyle(plugin)}
    >
      <button
        className="plugins-market-item-main"
        type="button"
        aria-label={`${plugin.name} ${installState}`}
        aria-pressed={isActive}
        onClick={() => onPluginSelect(plugin.id)}
      >
        <span className="plugins-market-item-mark">
          <PluginMark plugin={plugin} />
        </span>
        <span className="plugins-market-item-copy">
          <span className="plugins-market-item-title-row">
            <strong>{plugin.name}</strong>
            {visibleStatus ? <span className="plugins-market-item-state">{visibleStatus}</span> : null}
          </span>
          <span className="plugins-market-item-description">{plugin.description}</span>
          <span className="plugins-market-item-meta" aria-hidden="true">
            <span>由 {plugin.publisher} 开发</span>
            <span>{CATEGORY_LABELS[plugin.category]}</span>
            <span>{pluginCapabilityLabel(plugin)}</span>
            <span>{sourceLabel}</span>
          </span>
          {tags.length > 0 ? (
            <span className="plugins-market-item-tags" aria-hidden="true">
              {tags.map((tag) => <span key={tag}>{tag}</span>)}
            </span>
          ) : null}
        </span>
      </button>
      <span className="plugins-market-item-status">
        {installed && !packageMissing ? (
          <ConnectedStatusIcon />
        ) : (
          <button
            className="plugins-market-install-button"
            type="button"
            aria-label={`Install ${plugin.name}`}
            disabled={!canInstall || isBusy}
            onClick={() => onInstallPlugin(plugin.id)}
          >
            <PlusIcon />
          </button>
        )}
      </span>
    </div>
  )
}

interface InstalledPluginsSidebarProps {
  installedPlugins: InstalledPlugin[]
  pluginCatalog: PluginCatalogItem[]
  selectedPluginID: string | null
  onPluginSelect: (pluginID: string) => void
}

type InstalledPluginContextMenuState = {
  installed: InstalledPlugin
  name: string
  x: number
  y: number
} | null

const INSTALLED_PLUGIN_CONTEXT_MENU_WIDTH = 184
const INSTALLED_PLUGIN_CONTEXT_MENU_HEIGHT = 48
const INSTALLED_PLUGIN_DIRECT_PATH_KEYS = [
  "packageRoot",
  "localPath",
  "packagePath",
  "installPath",
  "directory",
  "path",
] as const

function installedPluginStatusText(installed: InstalledPlugin) {
  if (installed.missingPackage) return "Package missing"
  return installed.enabled ? "Enabled" : "Disabled"
}

function installedPluginAriaStatus(installed: InstalledPlugin) {
  if (installed.missingPackage) return "package missing"
  return installed.enabled ? "installed enabled" : "installed disabled"
}

function installedPluginStatusClassName(installed: InstalledPlugin) {
  if (installed.missingPackage) return "is-missing"
  return installed.enabled ? "is-enabled" : ""
}

function isAbsoluteLocalPath(targetPath: string) {
  return /^[a-zA-Z]:[\\/]/.test(targetPath) || targetPath.startsWith("\\\\") || targetPath.startsWith("/")
}

function clampInstalledPluginContextMenuPosition(x: number, y: number) {
  const margin = 8
  if (typeof window === "undefined") {
    return { x, y }
  }

  return {
    x: Math.max(margin, Math.min(x, window.innerWidth - INSTALLED_PLUGIN_CONTEXT_MENU_WIDTH - margin)),
    y: Math.max(margin, Math.min(y, window.innerHeight - INSTALLED_PLUGIN_CONTEXT_MENU_HEIGHT - margin)),
  }
}

function getInstalledPluginDirectPath(installed: InstalledPlugin) {
  const record = installed as unknown as Record<string, unknown>

  for (const key of INSTALLED_PLUGIN_DIRECT_PATH_KEYS) {
    const value = record[key]
    if (typeof value === "string") {
      const targetPath = value.trim()
      if (targetPath && isAbsoluteLocalPath(targetPath)) return targetPath
    }
  }

  return null
}

function pluginIDPathSegment(pluginID: string) {
  const segment = pluginID.trim()
  if (!segment || segment.includes("/") || segment.includes("\\") || segment.includes("..")) return null
  return segment
}

function joinLocalPath(rootPath: string, segment: string) {
  const root = rootPath.trim().replace(/[\\/]+$/, "")
  const separator = root.includes("\\") ? "\\" : "/"
  return `${root}${separator}${segment}`
}

function resolveInstalledPluginStoragePath(installed: InstalledPlugin, installedPluginsRoot: string) {
  const segment = pluginIDPathSegment(installed.pluginID)
  return segment ? joinLocalPath(installedPluginsRoot, segment) : installedPluginsRoot.trim()
}

function canOpenInstalledPluginLocalFiles(installed: InstalledPlugin) {
  if (installed.missingPackage) return false
  return Boolean(window.desktop?.openPath && (getInstalledPluginDirectPath(installed) || window.desktop.getStoragePaths))
}

async function openInstalledPluginLocalFiles(installed: InstalledPlugin) {
  if (installed.missingPackage) {
    throw new Error("Installed plugin package is missing.")
  }

  const openPath = window.desktop?.openPath
  if (!openPath) {
    throw new Error("Opening local plugin files is unavailable in this desktop shell.")
  }

  let targetPath = getInstalledPluginDirectPath(installed)
  if (!targetPath) {
    const storagePaths = await window.desktop?.getStoragePaths?.()
    if (!storagePaths) {
      throw new Error("Plugin storage paths are unavailable in this desktop shell.")
    }
    targetPath = resolveInstalledPluginStoragePath(installed, storagePaths.installedPlugins)
  }

  await openPath({ targetPath })
}

interface InstalledPluginContextMenuProps {
  menu: InstalledPluginContextMenuState
  onClose: () => void
}

function InstalledPluginContextMenu({
  menu,
  onClose,
}: InstalledPluginContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!menu) return

    function handlePointerDown(event: globalThis.PointerEvent) {
      const target = event.target as Node | null
      if (!target) return
      if (menuRef.current?.contains(target)) return
      onClose()
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        onClose()
      }
    }

    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    window.addEventListener("resize", onClose)
    window.addEventListener("scroll", onClose, true)

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("resize", onClose)
      window.removeEventListener("scroll", onClose, true)
    }
  }, [menu, onClose])

  if (!menu) return null

  const position = clampInstalledPluginContextMenuPosition(menu.x, menu.y)
  const canOpenLocalFiles = canOpenInstalledPluginLocalFiles(menu.installed)

  return createPortal(
    <div
      ref={menuRef}
      className="ui-context-menu plugins-installed-context-menu"
      role="menu"
      aria-label={`${menu.name} actions`}
      style={{ left: position.x, top: position.y }}
    >
      <button
        className="ui-context-menu__item"
        role="menuitem"
        type="button"
        disabled={!canOpenLocalFiles}
        onClick={(event) => {
          event.stopPropagation()
          onClose()
          void openInstalledPluginLocalFiles(menu.installed).catch((error) => {
            console.error("[plugins] Failed to open local plugin files.", error)
          })
        }}
      >
        <span className="ui-context-menu__icon" aria-hidden="true"><FolderOpenIcon /></span>
        <span className="ui-context-menu__label">Open local files</span>
      </button>
    </div>,
    document.body,
  )
}

function InstalledPluginsSidebar({
  installedPlugins,
  pluginCatalog,
  selectedPluginID,
  onPluginSelect,
}: InstalledPluginsSidebarProps) {
  const [contextMenu, setContextMenu] = useState<InstalledPluginContextMenuState>(null)
  const catalogByPluginID = useMemo(
    () => new Map(pluginCatalog.map((plugin) => [plugin.id, plugin])),
    [pluginCatalog],
  )
  const installedRows = useMemo(
    () => installedPlugins
      .map((installed) => ({
        installed,
        plugin: catalogByPluginID.get(installed.pluginID) ?? null,
      }))
      .sort((left, right) => {
        const leftName = left.plugin?.name ?? installedPluginDisplayName(left.installed.pluginID)
        const rightName = right.plugin?.name ?? installedPluginDisplayName(right.installed.pluginID)

        return leftName.localeCompare(rightName)
      }),
    [catalogByPluginID, installedPlugins],
  )

  function closeContextMenu() {
    setContextMenu(null)
  }

  return (
    <>
      <aside className="plugins-installed-sidebar" aria-label="Installed plugins">
        <div className="plugins-installed-sidebar-header">
          <h2>Installed</h2>
          <span>{installedPlugins.length}</span>
        </div>

        {installedRows.length > 0 ? (
          <div className="plugins-installed-list" role="list" aria-label="Installed plugins list">
            {installedRows.map(({ installed, plugin }) => {
              const name = plugin?.name ?? installedPluginDisplayName(installed.pluginID)
              const isActive = selectedPluginID === installed.pluginID
              const visibleStatus = installed.missingPackage || !installed.enabled ? installedPluginStatusText(installed) : null

              return (
                <div key={installed.pluginID} role="listitem">
                  <button
                    className={isActive ? "plugins-installed-item is-active" : "plugins-installed-item"}
                    type="button"
                    aria-label={`${name} ${installedPluginAriaStatus(installed)}`}
                    aria-pressed={isActive}
                    onClick={() => {
                      closeContextMenu()
                      onPluginSelect(installed.pluginID)
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      setContextMenu({
                        installed,
                        name,
                        x: event.clientX,
                        y: event.clientY,
                      })
                    }}
                  >
                    {plugin ? (
                      <PluginMark plugin={plugin} />
                    ) : (
                      <span className="plugins-icon-mark is-installed-placeholder" aria-hidden="true">
                        <PluginIcon />
                      </span>
                    )}
                    <span className="plugins-installed-copy">
                      <span className="plugins-installed-title">
                        <strong>{name}</strong>
                        <span className="plugins-installed-version">v{installed.version}</span>
                      </span>
                      {visibleStatus ? <span className="plugins-installed-state">{visibleStatus}</span> : null}
                    </span>
                    <span className={`plugins-installed-status-dot ${installedPluginStatusClassName(installed)}`} aria-hidden="true" />
                  </button>
                </div>
              )
            })}
          </div>
        ) : (
          <p className="plugins-installed-empty">No installed plugins yet.</p>
        )}
      </aside>
      <InstalledPluginContextMenu menu={contextMenu} onClose={closeContextMenu} />
    </>
  )
}

interface PluginSectionProps {
  canInstallPlugin: (plugin: PluginCatalogItem) => boolean
  installedByPluginID: Map<string, InstalledPlugin>
  pluginBusyIDs: Set<string>
  plugins: PluginCatalogItem[]
  selectedPluginID: string | null
  title: string
  onInstallPlugin: (pluginID: string) => boolean | Promise<boolean>
  onPluginSelect: (pluginID: string) => void
}

function PluginSection({
  canInstallPlugin,
  installedByPluginID,
  pluginBusyIDs,
  plugins,
  selectedPluginID,
  title,
  onInstallPlugin,
  onPluginSelect,
}: PluginSectionProps) {
  if (plugins.length === 0) return null

  return (
    <section className="plugins-directory-section" aria-label={`${title} plugins`}>
      <div className="plugins-directory-section-header">
        <h2>{title}</h2>
      </div>
      <div className="plugins-directory-grid" role="list" aria-label={title}>
        {plugins.map((plugin) => {
          const installed = installedByPluginID.get(plugin.id) ?? null

          return (
            <div key={plugin.id} role="listitem">
              <PluginMarketItem
                canInstall={canInstallPlugin(plugin)}
                installed={installed}
                isActive={plugin.id === selectedPluginID}
                isBusy={pluginBusyIDs.has(plugin.id)}
                plugin={plugin}
                onInstallPlugin={onInstallPlugin}
                onPluginSelect={onPluginSelect}
              />
            </div>
          )
        })}
      </div>
    </section>
  )
}

export function PluginsPage({
  activePluginID,
  connectorStatuses,
  deletingPluginID,
  diagnosingPluginID,
  installingPluginID,
  installedPlugins,
  hideTopMenu = false,
  isLoading,
  loadError,
  pluginCatalog,
  pluginConnectorStatuses,
  searchQuery,
  updatingPluginID,
  windowControls,
  diagnosingPluginConnectorID,
  pluginDraft,
  savingPluginConnectorID,
  onCancelInstalledPluginConnectorAuthFlow,
  onDeleteInstalledPlugin,
  onDeleteInstalledPluginConnectorApiKey,
  onDeleteInstalledPluginConnectorAuthSession,
  onDiagnoseInstalledPluginConnector,
  onInstallPlugin,
  onPluginDraftAppApiKeyChange,
  onPluginDraftConfigChange,
  onPluginDeselect,
  onPluginSelect,
  onSaveInstalledPluginConnectorApiKey,
  onSaveInstalledPluginConfig,
  onStartInstalledPluginConnectorAuthFlow,
}: PluginsPageProps) {
  const [categoryFilter, setCategoryFilter] = useState<PluginCategory | "All">("All")
  const [expandedIncludedItemID, setExpandedIncludedItemID] = useState<string | null>(null)
  const effectiveSearchQuery = searchQuery ?? ""

  const installedByPluginID = useMemo(
    () => new Map(installedPlugins.map((plugin) => [plugin.pluginID, plugin])),
    [installedPlugins],
  )
  const categoryCounts = useMemo(() => {
    const counts = new Map<PluginCategory | "All", number>([["All", pluginCatalog.length]])

    for (const category of CATEGORY_FILTERS) {
      if (category !== "All") counts.set(category, 0)
    }

    for (const plugin of pluginCatalog) {
      counts.set(plugin.category, (counts.get(plugin.category) ?? 0) + 1)
    }

    return counts
  }, [pluginCatalog])
  const filteredPlugins = useMemo(() => {
    const normalizedQuery = effectiveSearchQuery.trim().toLowerCase()
    return pluginCatalog.filter((plugin) => {
      if (categoryFilter !== "All" && plugin.category !== categoryFilter) return false
      if (!normalizedQuery) return true

      return [
        plugin.name,
        plugin.publisher,
        plugin.description,
        plugin.longDescription ?? "",
        plugin.category,
        (plugin.tags ?? []).join(" "),
        plugin.tools.map((tool) => tool.name).join(" "),
        plugin.skills.map((skill) => skill.name).join(" "),
        plugin.connectorRequirements.map((requirement) => requirement.connector).join(" "),
        plugin.apps.map((app) => app.name).join(" "),
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery)
    })
  }, [categoryFilter, pluginCatalog, effectiveSearchQuery])

  const activePlugin = activePluginID ? pluginCatalog.find((plugin) => plugin.id === activePluginID) ?? null : null
  const activeInstalledPlugin = activePlugin ? installedByPluginID.get(activePlugin.id) ?? null : null
  const activeConnectorStatuses = activePlugin ? pluginConnectorStatuses[activePlugin.id] ?? [] : []
  const activeConnectorStatusByAppID = useMemo(
    () => new Map(activeConnectorStatuses.map((status) => [status.appID, status])),
    [activeConnectorStatuses],
  )
  const platformConnectorStatusByDefinitionID = useMemo(
    () => new Map(connectorStatuses.map((status) => [status.definitionID, status])),
    [connectorStatuses],
  )
  const pluginBusyIDs = useMemo(
    () => new Set([installingPluginID, updatingPluginID, deletingPluginID, diagnosingPluginID].filter(Boolean) as string[]),
    [deletingPluginID, diagnosingPluginID, installingPluginID, updatingPluginID],
  )
  const canInstallPlugin = (plugin: PluginCatalogItem) => {
    const installed = installedByPluginID.get(plugin.id)
    return (!installed || Boolean(installed.missingPackage)) &&
      plugin.installable !== false &&
      plugin.risk !== "critical" &&
      !pluginBusyIDs.has(plugin.id)
  }
  const canInstallActivePlugin = Boolean(activePlugin && canInstallPlugin(activePlugin))
  const canDeleteActivePlugin = Boolean(
    activePlugin &&
      activeInstalledPlugin &&
      !activeInstalledPlugin.missingPackage &&
      !pluginBusyIDs.has(activePlugin.id),
  )
  const activePluginInstallLabel = activePlugin && installingPluginID === activePlugin.id
    ? "Installing..."
    : activeInstalledPlugin?.missingPackage ? "Download again" : "Install"
  const activePluginUninstallLabel = activePlugin && deletingPluginID === activePlugin.id
    ? "Uninstalling..."
    : "Uninstall"
  const hasDirectoryFilters =
    effectiveSearchQuery.trim().length > 0 ||
    categoryFilter !== "All"
  const featuredPlugins = useMemo(() => {
    const installedMatches = filteredPlugins.filter((plugin) => installedByPluginID.has(plugin.id))
    const priorityPlugins = installedMatches.length > 0 ? installedMatches : filteredPlugins
    return priorityPlugins.slice(0, FEATURED_PLUGIN_LIMIT)
  }, [filteredPlugins, installedByPluginID])
  const shouldShowFeatured = !hasDirectoryFilters && featuredPlugins.length > 0
  const featuredPluginIDs = useMemo(() => new Set(featuredPlugins.map((plugin) => plugin.id)), [featuredPlugins])
  const directorySections = useMemo(() => {
    const groups = new Map<PluginCategory, PluginCatalogItem[]>()

    for (const plugin of filteredPlugins) {
      if (shouldShowFeatured && featuredPluginIDs.has(plugin.id)) continue

      const items = groups.get(plugin.category) ?? []
      items.push(plugin)
      groups.set(plugin.category, items)
    }

    return CATEGORY_FILTERS.flatMap((category) => {
      if (category === "All") return []
      const items = groups.get(category) ?? []
      return items.length > 0 ? [{ category, items }] : []
    })
  }, [featuredPluginIDs, filteredPlugins, shouldShowFeatured])
  const selectedPluginID = activePlugin?.id ?? null
  const hasPluginMatches = filteredPlugins.length > 0
  const isPluginDetailView = Boolean(activePlugin)
  const activeBrandColor = activePlugin ? pluginBrandColor(activePlugin) : undefined
  const defaultOAuthApp = activePlugin?.apps.find((app) => app.credential.kind === "oauth")
  const defaultIncludedItemID = activePlugin && defaultOAuthApp
    ? `${activePlugin.id}:app:${defaultOAuthApp.appID}`
    : null
  const pluginBreadcrumb = (
    <nav className="plugins-detail-breadcrumb" aria-label="Plugin detail breadcrumb">
      {activePlugin ? (
        <>
          <button type="button" onClick={onPluginDeselect}>插件</button>
          <ChevronRightIcon />
          <span>{activePlugin.name}</span>
        </>
      ) : (
        <span>插件</span>
      )}
    </nav>
  )
  const toggleIncludedItem = (itemID: string) => {
    setExpandedIncludedItemID((currentItemID) => currentItemID === itemID ? null : itemID)
  }

  useEffect(() => {
    setExpandedIncludedItemID(defaultIncludedItemID)
  }, [defaultIncludedItemID])

  return (
    <section className={hideTopMenu ? "plugins-page is-embedded" : "plugins-page"} aria-label="Plugins">
      {!hideTopMenu ? (
        <ShellTopMenu
          as="header"
          ariaLabel="Plugins top menu"
          className="canvas-region-top-menu plugins-top-menu"
          contentClassName="plugins-top-menu-actions-shell"
          content={(
            <div className="plugins-top-menu-actions">
              {activePlugin ? (
                null
              ) : (
                <button className="plugins-top-menu-button" type="button" disabled>
                  <SettingsIcon />
                  <span>管理</span>
                </button>
              )}
            </div>
          )}
          dragRegion
          trailing={windowControls}
          trailingClassName="prompt-presets-top-menu-window-controls"
        />
      ) : null}

      <div className="plugins-page-main">
        {loadError ? <div className="settings-banner is-error">{loadError}</div> : null}

        {isLoading ? (
          <article className="settings-empty-state plugins-loading-state">
            <span className="label">Loading</span>
            <h3>Fetching plugins</h3>
            <p>Reading the curated catalog and installed plugin state.</p>
          </article>
        ) : (
          <div className={isPluginDetailView ? "plugins-marketplace-shell is-detail-view" : "plugins-marketplace-shell"}>
            <div className="settings-service-list-panel plugins-list-panel plugins-marketplace-sidebar-column">
              <InstalledPluginsSidebar
                installedPlugins={installedPlugins}
                pluginCatalog={pluginCatalog}
                selectedPluginID={selectedPluginID}
                onPluginSelect={onPluginSelect}
              />
            </div>

            <div className={isPluginDetailView ? "settings-service-detail-panel plugins-marketplace-content is-detail-view" : "settings-service-detail-panel plugins-marketplace-content"}>
              {pluginBreadcrumb}
              {!activePlugin ? (
              <>
                <PluginCategoryNavigation
                  activeCategory={categoryFilter}
                  categoryCounts={categoryCounts}
                  onCategoryChange={setCategoryFilter}
                />

                <div className="plugins-directory" role="region" aria-label="Plugin marketplace layout">
                  {hasPluginMatches ? (
                    <>
                      {shouldShowFeatured ? (
                        <PluginSection
                          canInstallPlugin={canInstallPlugin}
                          installedByPluginID={installedByPluginID}
                          pluginBusyIDs={pluginBusyIDs}
                          plugins={featuredPlugins}
                          selectedPluginID={selectedPluginID}
                          title="Featured"
                          onInstallPlugin={onInstallPlugin}
                          onPluginSelect={onPluginSelect}
                        />
                      ) : null}

                      {directorySections.map(({ category, items }) => (
                        <PluginSection
                          key={category}
                          canInstallPlugin={canInstallPlugin}
                          installedByPluginID={installedByPluginID}
                          pluginBusyIDs={pluginBusyIDs}
                          plugins={items}
                          selectedPluginID={selectedPluginID}
                          title={CATEGORY_LABELS[category]}
                          onInstallPlugin={onInstallPlugin}
                          onPluginSelect={onPluginSelect}
                        />
                      ))}
                    </>
                  ) : (
                    <article className="settings-empty-state plugins-directory-empty-state">
                      <span className="label">No Matches</span>
                      <h3>No plugins match the current filters</h3>
                      <p>Adjust the search text, builder, or category filter.</p>
                    </article>
                  )}
                </div>
              </>
            ) : null}

            {activePlugin ? (
              <section className="plugins-management-detail" aria-label="Selected plugin details">
                <>
                  <header className="plugins-detail-header">
                    <PluginMark plugin={activePlugin} />
                    <h1>{activePlugin.name}</h1>
                    <p>{activePlugin.description}</p>
                    {(activePlugin.tags ?? []).length > 0 ? (
                      <div className="plugins-tag-row" aria-label={`${activePlugin.name} tags`}>
                        {(activePlugin.tags ?? []).slice(0, 8).map((tag) => (
                          <span key={tag} className="settings-badge">{tag}</span>
                        ))}
                      </div>
                    ) : null}
                  </header>

                  <p className="plugins-detail-description">{pluginDetailDescription(activePlugin)}</p>

                  {activePlugin.configFields.length > 0 ? (
                    <section className="plugins-detail-section">
                      <h2>Configuration</h2>
                      <div className="plugins-config-card">
                        <div className="plugins-config-fields">
                          {activePlugin.configFields.map((field) => {
                            const inputID = `plugin-config:${activePlugin.id}:${field.key}`

                            return (
                              <label key={field.key} className="plugins-config-field" htmlFor={inputID}>
                                <span className="plugins-config-field-label">
                                  <span>{field.label}</span>
                                  {field.required ? <span className="plugins-config-required">Required</span> : null}
                                </span>
                                <input
                                  id={inputID}
                                  type={pluginConfigInputType(field)}
                                  value={pluginDraft.config[field.key] ?? ""}
                                  placeholder={field.placeholder ?? field.key}
                                  autoComplete={field.secret ? "new-password" : "off"}
                                  required={field.required}
                                  onChange={(event) => onPluginDraftConfigChange(field.key, event.target.value)}
                                />
                                {field.description ? <small>{field.description}</small> : null}
                              </label>
                            )
                          })}
                        </div>
                        <div className="plugins-config-actions">
                          <span>
                            {activeInstalledPlugin && !activeInstalledPlugin.missingPackage
                              ? "Saved values are injected into this plugin at runtime."
                              : "Required values are used when installing this plugin."}
                          </span>
                          {activeInstalledPlugin && !activeInstalledPlugin.missingPackage ? (
                            <button
                              className="plugins-detail-install-button"
                              type="button"
                              disabled={pluginBusyIDs.has(activePlugin.id)}
                              onClick={() => void onSaveInstalledPluginConfig(activePlugin.id)}
                            >
                              {updatingPluginID === activePlugin.id ? "Saving..." : "Save configuration"}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </section>
                  ) : null}

                  {(activePlugin.screenshots ?? []).length > 0 ? (
                    <section className="plugins-detail-section">
                      <h2>Screenshots</h2>
                      <div className="plugins-screenshot-grid">
                        {(activePlugin.screenshots ?? []).slice(0, 4).map((screenshot, index) => (
                          <img
                            key={screenshot}
                            src={screenshot}
                            alt={`${activePlugin.name} screenshot ${index + 1}`}
                          />
                        ))}
                      </div>
                    </section>
                  ) : null}

                  <section className="plugins-detail-section">
                    <h2>包含内容</h2>
                    <div className="plugins-included-card">
                      {activePlugin.mcpServers.map((server) => {
                        const itemID = `${activePlugin.id}:mcp:${server.id}`
                        const isExpanded = expandedIncludedItemID === itemID

                        return (
                          <div key={`mcp:${server.id}`} className="plugins-included-item">
                            <button
                              className={isExpanded ? "plugins-included-row is-expanded" : "plugins-included-row"}
                              type="button"
                              aria-expanded={isExpanded}
                              aria-controls={`${itemID}:detail`}
                              aria-label={`Show details for ${server.name}`}
                              onClick={() => toggleIncludedItem(itemID)}
                            >
                              <span className="plugins-included-icon"><PluginIcon /></span>
                              <span className="plugins-included-copy">
                                <strong>{server.name}</strong>
                                <span>{runtimeTitle(server.runtime)}</span>
                              </span>
                              <span className={activeInstalledPlugin?.enabled ? "plugins-toggle is-on" : "plugins-toggle"} aria-hidden="true">
                                <span />
                              </span>
                              <span className="plugins-included-chevron" aria-hidden="true"><ChevronDownIcon /></span>
                            </button>
                            {isExpanded ? (
                              <div className="plugins-included-detail" id={`${itemID}:detail`}>
                                <dl className="plugins-included-detail-grid">
                                  <div>
                                    <dt>Type</dt>
                                    <dd>MCP server</dd>
                                  </div>
                                  <div>
                                    <dt>Server ID</dt>
                                    <dd>{generatedServerID(activePlugin, server)}</dd>
                                  </div>
                                  <div>
                                    <dt>Runtime</dt>
                                    <dd>{runtimePrimary(server.runtime)}</dd>
                                  </div>
                                  <div>
                                    <dt>Runtime details</dt>
                                    <dd>{runtimeSecondary(server.runtime)}</dd>
                                  </div>
                                  <div>
                                    <dt>Tools</dt>
                                    <dd>{toolSummary(server.tools)}</dd>
                                  </div>
                                  <div>
                                    <dt>Permissions</dt>
                                    <dd>{permissionSummary(server.permissions)}</dd>
                                  </div>
                                  {server.description ? (
                                    <div className="is-wide">
                                      <dt>Description</dt>
                                      <dd>{server.description}</dd>
                                    </div>
                                  ) : null}
                                </dl>
                              </div>
                            ) : null}
                          </div>
                        )
                      })}
                      {activePlugin.skills.map((skill) => {
                        const itemID = `${activePlugin.id}:skill:${skill.id}`
                        const isExpanded = expandedIncludedItemID === itemID

                        return (
                          <div key={`skill:${skill.id}`} className="plugins-included-item">
                            <button
                              className={isExpanded ? "plugins-included-row is-expanded" : "plugins-included-row"}
                              type="button"
                              aria-expanded={isExpanded}
                              aria-controls={`${itemID}:detail`}
                              aria-label={`Show details for ${skill.name}`}
                              onClick={() => toggleIncludedItem(itemID)}
                            >
                              <span className="plugins-included-icon"><SettingsIcon /></span>
                              <span className="plugins-included-copy">
                                <strong>{skill.name}</strong>
                                <span>{skill.description}</span>
                              </span>
                              <span className={activeInstalledPlugin?.enabled ? "plugins-toggle is-on" : "plugins-toggle"} aria-hidden="true">
                                <span />
                              </span>
                              <span className="plugins-included-chevron" aria-hidden="true"><ChevronDownIcon /></span>
                            </button>
                            {isExpanded ? (
                              <div className="plugins-included-detail" id={`${itemID}:detail`}>
                                <dl className="plugins-included-detail-grid">
                                  <div>
                                    <dt>Type</dt>
                                    <dd>Helper skill</dd>
                                  </div>
                                  <div>
                                    <dt>Skill ID</dt>
                                    <dd>{skill.id}</dd>
                                  </div>
                                  <div>
                                    <dt>Directory</dt>
                                    <dd>{skill.directory}</dd>
                                  </div>
                                  <div className="is-wide">
                                    <dt>Description</dt>
                                    <dd>{skill.description}</dd>
                                  </div>
                                </dl>
                              </div>
                            ) : null}
                          </div>
                        )
                      })}
                      {activePlugin.connectorRequirements.map((requirement) => {
                        const itemID = `${activePlugin.id}:connector-requirement:${requirement.connector}`
                        const isExpanded = expandedIncludedItemID === itemID
                        const status = platformConnectorStatusByDefinitionID.get(requirement.connector)
                        const connectorID = status?.connectorID ?? `connector:${requirement.connector}:default`
                        const requestedTools = requirement.tools?.join(", ") || "Declared by connector"
                        const requestedPermissions = requirement.permissions?.join(", ") || "Declared by connector"

                        return (
                          <div key={`connector-requirement:${requirement.connector}`} className="plugins-included-item">
                            <button
                              className={isExpanded ? "plugins-included-row is-expanded" : "plugins-included-row"}
                              type="button"
                              aria-expanded={isExpanded}
                              aria-controls={`${itemID}:detail`}
                              aria-label={`Show details for ${requirement.connector}`}
                              onClick={() => toggleIncludedItem(itemID)}
                            >
                              <span className="plugins-included-icon"><ConnectedStatusIcon /></span>
                              <span className="plugins-included-copy">
                                <strong>{requirement.connector}</strong>
                                <span>{requirement.reason ?? "Platform connector requirement"}</span>
                              </span>
                              <span className={status?.connected ? "plugins-toggle is-on" : "plugins-toggle"} aria-hidden="true">
                                <span />
                              </span>
                              <span className="plugins-included-chevron" aria-hidden="true"><ChevronDownIcon /></span>
                            </button>
                            {isExpanded ? (
                              <div className="plugins-included-detail" id={`${itemID}:detail`}>
                                <dl className="plugins-included-detail-grid">
                                  <div>
                                    <dt>Type</dt>
                                    <dd>Platform connector</dd>
                                  </div>
                                  <div>
                                    <dt>Connector</dt>
                                    <dd>{requirement.connector}</dd>
                                  </div>
                                  <div>
                                    <dt>Status</dt>
                                    <dd>{connectorStatusLabel(status)}</dd>
                                  </div>
                                  <div>
                                    <dt>Connector ID</dt>
                                    <dd>{connectorID}</dd>
                                  </div>
                                  {status?.email ? (
                                    <div>
                                      <dt>Account</dt>
                                      <dd>{status.email}</dd>
                                    </div>
                                  ) : null}
                                  {status?.generatedMcpServerID ? (
                                    <div>
                                      <dt>MCP server</dt>
                                      <dd>{status.generatedMcpServerID}</dd>
                                    </div>
                                  ) : null}
                                  <div>
                                    <dt>Required</dt>
                                    <dd>{requirement.required === false ? "Optional" : "Required"}</dd>
                                  </div>
                                  <div>
                                    <dt>Tools</dt>
                                    <dd>{requestedTools}</dd>
                                  </div>
                                  <div>
                                    <dt>Permissions</dt>
                                    <dd>{requestedPermissions}</dd>
                                  </div>
                                  {requirement.reason ? (
                                    <div className="is-wide">
                                      <dt>Reason</dt>
                                      <dd>{requirement.reason}</dd>
                                    </div>
                                  ) : null}
                                </dl>
                              </div>
                            ) : null}
                          </div>
                        )
                      })}
                      {activePlugin.apps.map((app) => {
                        const itemID = `${activePlugin.id}:app:${app.appID}`
                        const isExpanded = expandedIncludedItemID === itemID
                        const status = activeConnectorStatusByAppID.get(app.appID)
                        const connectorKey = `${activePlugin.id}:${app.appID}`
                        const credentialKind = app.credential.kind === "oauth" ? "oauth" : "api_key"
                        const apiKeyCredential = app.credential.kind === "oauth" ? null : app.credential
                        const isBusy = savingPluginConnectorID === connectorKey
                        const isDiagnosing = diagnosingPluginConnectorID === connectorKey
                        const activeFlow = status?.activeFlow
                        const hasPendingFlow = activeFlow && ["pending", "waiting_user", "authorizing"].includes(activeFlow.status)
                        const appSummary = activeInstalledPlugin
                          ? `${connectorStatusLabel(status)} - ${app.description ?? "Connector-backed MCP"}`
                          : `Install to enable ${credentialKindLabel(credentialKind)}`

                        return (
                          <div key={`app:${app.appID}`} className="plugins-included-item">
                            <button
                              className={isExpanded ? "plugins-included-row is-expanded" : "plugins-included-row"}
                              type="button"
                              aria-expanded={isExpanded}
                              aria-controls={`${itemID}:detail`}
                              aria-label={`Show details for ${app.name}`}
                              onClick={() => toggleIncludedItem(itemID)}
                            >
                              <span className="plugins-included-icon"><ConnectedStatusIcon /></span>
                              <span className="plugins-included-copy">
                                <strong>{app.name}</strong>
                                <span>{appSummary}</span>
                              </span>
                              <span className={status?.connected ? "plugins-toggle is-on" : "plugins-toggle"} aria-hidden="true">
                                <span />
                              </span>
                              <span className="plugins-included-chevron" aria-hidden="true"><ChevronDownIcon /></span>
                            </button>
                            {isExpanded ? (
                              <div className="plugins-included-detail" id={`${itemID}:detail`}>
                                <dl className="plugins-included-detail-grid">
                                  <div>
                                    <dt>Type</dt>
                                    <dd>Plugin connector</dd>
                                  </div>
                                  <div>
                                    <dt>Status</dt>
                                    <dd>{connectorStatusLabel(status)}</dd>
                                  </div>
                                  <div>
                                    <dt>Connector ID</dt>
                                    <dd>{status?.connectorID ?? `plugin-connector:${activePlugin.id}:${app.appID}`}</dd>
                                  </div>
                                  <div>
                                    <dt>Credential</dt>
                                    <dd>{app.credential.label}</dd>
                                  </div>
                                  <div>
                                    <dt>Credential kind</dt>
                                    <dd>{credentialKindLabel(credentialKind)}</dd>
                                  </div>
                                  {status?.email ? (
                                    <div>
                                      <dt>Account</dt>
                                      <dd>{status.email}</dd>
                                    </div>
                                  ) : null}
                                  <div>
                                    <dt>Endpoint</dt>
                                    <dd>{runtimePrimary(app.runtime)}</dd>
                                  </div>
                                  <div>
                                    <dt>Tools</dt>
                                    <dd>{toolSummary(app.tools)}</dd>
                                  </div>
                                  <div>
                                    <dt>Permissions</dt>
                                    <dd>{permissionSummary(app.permissions)}</dd>
                                  </div>
                                  <div className="is-wide">
                                    <dt>Description</dt>
                                    <dd>{app.description ?? app.credential.description ?? "Connector-backed MCP"}</dd>
                                  </div>
                                </dl>
                                {activeInstalledPlugin ? (
                                  <div className="plugins-connector-actions">
                                    {!apiKeyCredential ? (
                                      <>
                                        {hasPendingFlow ? (
                                          <button
                                            className="plugins-detail-uninstall-button"
                                            type="button"
                                            disabled={isBusy}
                                            onClick={() => void onCancelInstalledPluginConnectorAuthFlow(activePlugin.id, app.appID)}
                                          >
                                            {isBusy ? "Cancelling..." : "Cancel sign-in"}
                                          </button>
                                        ) : (
                                          <button
                                            className="plugins-detail-install-button"
                                            type="button"
                                            disabled={isBusy}
                                            onClick={() => void onStartInstalledPluginConnectorAuthFlow(activePlugin.id, app.appID)}
                                          >
                                            {isBusy ? "Opening..." : status?.connected ? "Reconnect" : "Sign in"}
                                          </button>
                                        )}
                                        {status?.connected ? (
                                          <button
                                            className="plugins-detail-uninstall-button"
                                            type="button"
                                            disabled={isBusy}
                                            onClick={() => void onDeleteInstalledPluginConnectorAuthSession(activePlugin.id, app.appID)}
                                          >
                                            {isBusy ? "Disconnecting..." : "Disconnect"}
                                          </button>
                                        ) : null}
                                      </>
                                    ) : (
                                      <>
                                        <label className="plugins-connector-key-field">
                                          <span>{app.credential.label}</span>
                                          <input
                                            type="password"
                                            value={pluginDraft.appApiKeys[app.appID] ?? ""}
                                            placeholder={apiKeyCredential.placeholder ?? "Enter API key"}
                                            onChange={(event) => onPluginDraftAppApiKeyChange(app.appID, event.target.value)}
                                          />
                                        </label>
                                        <button
                                          className="plugins-detail-install-button"
                                          type="button"
                                          disabled={isBusy}
                                          onClick={() => void onSaveInstalledPluginConnectorApiKey(activePlugin.id, app.appID)}
                                        >
                                          {isBusy ? "Saving..." : "Update key"}
                                        </button>
                                        {status?.connected ? (
                                          <button
                                            className="plugins-detail-uninstall-button"
                                            type="button"
                                            disabled={isBusy}
                                            onClick={() => void onDeleteInstalledPluginConnectorApiKey(activePlugin.id, app.appID)}
                                          >
                                            {isBusy ? "Clearing..." : "Disconnect"}
                                          </button>
                                        ) : null}
                                      </>
                                    )}
                                    <button
                                      className="plugins-detail-uninstall-button"
                                      type="button"
                                      disabled={isDiagnosing}
                                      onClick={() => void onDiagnoseInstalledPluginConnector(activePlugin.id, app.appID)}
                                    >
                                      {isDiagnosing ? "Checking..." : "Diagnose"}
                                    </button>
                                  </div>
                                ) : (
                                  <p className="plugins-connector-empty">
                                    Install this plugin before signing in to this connector.
                                  </p>
                                )}
                              </div>
                            ) : null}
                          </div>
                        )
                      })}
                    </div>
                  </section>

                  <section className="plugins-detail-section">
                    <h2>信息</h2>
                    <div className="plugins-info-table">
                      <div>
                        <span>类别</span>
                        <strong>由 {activePlugin.publisher} 开发 · {CATEGORY_LABELS[activePlugin.category]}</strong>
                      </div>
                      <div>
                        <span>功能</span>
                        <strong>{pluginFunctionLabel(activePlugin)}</strong>
                      </div>
                      <div>
                        <span>开发者</span>
                        <strong>{activePlugin.publisher}</strong>
                      </div>
                      <div>
                        <span>版本</span>
                        <strong>{activePlugin.version}</strong>
                      </div>
                      <div>
                        <span>网站</span>
                        {activePlugin.homepage ? (
                          <a
                            className="plugins-info-link"
                            href={activePlugin.homepage}
                            target="_blank"
                            rel="noreferrer"
                            title={`Open ${activePlugin.name} website`}
                            onClick={(event) => handlePluginInfoLinkClick(event, activePlugin.homepage!)}
                          >
                            <span className="plugins-info-link-text">{activePlugin.homepage}</span>
                            <OpenExternalIcon />
                          </a>
                        ) : (
                          <strong>未提供</strong>
                        )}
                      </div>
                      <div>
                        <span>文档</span>
                        {activePlugin.documentationUrl ? (
                          <a
                            className="plugins-info-link"
                            href={activePlugin.documentationUrl}
                            target="_blank"
                            rel="noreferrer"
                            title={`Open ${activePlugin.name} documentation`}
                            onClick={(event) => handlePluginInfoLinkClick(event, activePlugin.documentationUrl!)}
                          >
                            <span className="plugins-info-link-text">{activePlugin.documentationUrl}</span>
                            <OpenExternalIcon />
                          </a>
                        ) : (
                          <strong>未提供</strong>
                        )}
                      </div>
                      <div>
                        <span>风险等级</span>
                        <strong>{activePlugin.risk}</strong>
                      </div>
                      {activeBrandColor ? (
                        <div>
                          <span>Brand</span>
                          <strong className="plugins-brand-color">
                            <span style={{ background: activeBrandColor }} />
                            {activeBrandColor}
                          </strong>
                        </div>
                      ) : null}
                    </div>
                    <div className="plugins-detail-actions" aria-label={`${activePlugin.name} plugin actions`}>
                      {activeInstalledPlugin && !activeInstalledPlugin.missingPackage ? (
                        <>
                          <span className="plugins-detail-action-status" aria-label={`${activePlugin.name} installed`}>
                            <ConnectedStatusIcon />
                            <span>{activeInstalledPlugin.enabled ? "Installed" : "Disabled"}</span>
                          </span>
                          <button
                            className="plugins-detail-uninstall-button"
                            type="button"
                            aria-label={`Uninstall ${activePlugin.name}`}
                            disabled={!canDeleteActivePlugin}
                            onClick={() => void onDeleteInstalledPlugin(activePlugin.id)}
                          >
                            <DeleteIcon />
                            <span>{activePluginUninstallLabel}</span>
                          </button>
                        </>
                      ) : (
                        <button
                          className="plugins-detail-install-button"
                          type="button"
                          aria-label={`Install ${activePlugin.name}`}
                          disabled={!canInstallActivePlugin}
                          onClick={() => onInstallPlugin(activePlugin.id)}
                        >
                          <PlusIcon />
                          <span>{activePluginInstallLabel}</span>
                        </button>
                      )}
                    </div>
                  </section>
                </>
              </section>
            ) : null}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
