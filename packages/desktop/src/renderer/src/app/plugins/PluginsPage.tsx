import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type MouseEvent, type ReactNode } from "react"
import { createPortal } from "react-dom"
import {
  BackIcon,
  ChevronDownIcon,
  CloseIcon,
  ConnectedStatusIcon,
  DeleteIcon,
  FolderOpenIcon,
  McpIcon,
  OpenExternalIcon,
  PluginIcon,
  PlusIcon,
  SettingsIcon,
  SkillIcon,
} from "../icons"
import { ShellTopMenu, joinClassNames } from "../shared-ui"
import { McpToolsPolicyPanel } from "../mcp/McpToolsPolicyPanel"
import { mcpToolPolicyDraftFromServer } from "../mcp/mcp-tool-policies"
import { installedPluginDisplayName } from "../plugin-catalog"
import { PluginSkillBrowserPanel } from "./PluginSkillBrowserPanel"
import { useI18n } from "../i18n/I18nProvider"
import type { TranslationKey } from "../i18n/translations"
import type { AppLocale } from "../../../../shared/locale"
import type {
  ConnectorStatus,
  InstalledPlugin,
  McpServerDiagnostic,
  McpServerSummary,
  McpToolPolicyValue,
  PluginCatalogItem,
  PluginCategory,
  PluginConnectorStatus,
  PluginDraftState,
  PluginRuntimeTemplate,
  PluginSkillPreview,
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
  mcpDiagnostics: Record<string, McpServerDiagnostic>
  mcpServers: McpServerSummary[]
  diagnosingMcpServerID: string | null
  savingMcpServerID: string | null
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
  onDiagnoseMcpServer: (serverID: string) => boolean | Promise<boolean>
  onImportPluginFromURL: (url: string) => boolean | Promise<boolean>
  onInstallPlugin: (pluginID: string) => boolean | Promise<boolean>
  onPluginDraftAppApiKeyChange: (appID: string, value: string) => void
  onPluginDraftConfigChange: (key: string, value: string) => void
  onPluginDeselect: () => void
  onPluginSelect: (pluginID: string) => void
  onSaveInstalledPluginConnectorApiKey: (pluginID: string, appID: string) => boolean | Promise<boolean>
  onSaveInstalledPluginConfig: (pluginID: string) => boolean | Promise<boolean>
  onSearchQueryChange?: (value: string) => void
  onSetInstalledPluginEnabled: (pluginID: string, enabled: boolean) => boolean | Promise<boolean>
  onSetInstalledPluginMcpEnabled: (
    pluginID: string,
    serverID: string,
    enabled: boolean,
  ) => boolean | Promise<boolean>
  onSetInstalledPluginMcpToolPolicy: (
    pluginID: string,
    serverID: string,
    toolName: string,
    policy: McpToolPolicyValue,
  ) => boolean | Promise<boolean>
  onManageConnector?: (connectorID: string) => void
  onManageMcpServer?: (serverID: string) => void
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

type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string

const CATEGORY_LABEL_KEYS: Record<PluginCategory | "All", TranslationKey> = {
  All: "plugins.category.all",
  Code: "plugins.category.code",
  Browser: "plugins.category.browser",
  Git: "plugins.category.git",
  Database: "plugins.category.database",
  Docs: "plugins.category.docs",
  Automation: "plugins.category.automation",
  Design: "plugins.category.design",
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

function generatedAppServerID(plugin: PluginCatalogItem, appID: string) {
  return `plugin.${plugin.id}.connector.${appID}`
}

function matchesAnyboxMcpRequirement(
  server: McpServerSummary,
  mcpDefinitionID: string,
) {
  return (
    server.owner?.kind === "anybox"
    && server.owner.bindingID === mcpDefinitionID
    && server.id === `anybox.${mcpDefinitionID}`
    && server.transport === "stdio"
  )
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

function connectorStatusDotClassName(status: ConnectorStatus | PluginConnectorStatus | undefined) {
  if (status?.connected) return "is-connected"
  if (status?.authStatus === "pending") return "is-pending"
  if (status?.authStatus === "error" || status?.authStatus === "expired") return "is-error"
  if (status?.authStatus === "unavailable") return "is-unavailable"
  return "is-disconnected"
}

function findPluginMcpServer(
  servers: McpServerSummary[],
  installed: InstalledPlugin | null,
  pluginID: string,
  bindingID: string,
  fallbackServerID: string,
) {
  const ownedBinding = servers.find(
    (server) => server.owner?.kind === "plugin"
      && server.owner.pluginID === pluginID
      && server.owner.bindingID === bindingID,
  )
  if (ownedBinding) return ownedBinding

  if (!installed?.mcpServerIDs.includes(fallbackServerID)) return undefined
  return servers.find((server) => server.id === fallbackServerID && !server.owner)
}

interface PluginMcpControlsProps {
  diagnostic: McpServerDiagnostic | null
  installed: InstalledPlugin | null
  isDiagnosing: boolean
  isSaving: boolean
  pluginID: string
  server: McpServerSummary | undefined
  t: Translate
  onDiagnose: (serverID: string) => boolean | Promise<boolean>
  onEnabledChange: (pluginID: string, serverID: string, enabled: boolean) => boolean | Promise<boolean>
  onPolicyChange: (
    pluginID: string,
    serverID: string,
    toolName: string,
    policy: McpToolPolicyValue,
  ) => boolean | Promise<boolean>
  onRepair: () => boolean | Promise<boolean>
}

function PluginMcpControls({
  diagnostic,
  installed,
  isDiagnosing,
  isSaving,
  pluginID,
  server,
  t,
  onDiagnose,
  onEnabledChange,
  onPolicyChange,
  onRepair,
}: PluginMcpControlsProps) {
  if (!installed || installed.missingPackage) {
    return <p className="plugins-connector-empty">{t("plugins.mcp.installPreview")}</p>
  }

  if (!server) {
    return (
      <div className="plugins-mcp-binding-error">
        <div className="settings-banner is-error" role="alert">
          {t("plugins.mcp.bindingMissing")}
        </div>
        <button
          className="plugins-detail-uninstall-button"
          type="button"
          onClick={() => void onRepair()}
        >
          {t("plugins.mcp.repair")}
        </button>
      </div>
    )
  }

  const preferenceEnabled = installed.mcpServerEnabled[server.id] ?? true
  const controlsDisabled = isSaving || !installed.enabled
  const diagnosticDisabled = controlsDisabled || isDiagnosing || !preferenceEnabled || !server.enabled
  const preferenceCopy = !installed.enabled
    ? t("plugins.mcp.pausedByPlugin")
    : preferenceEnabled
      ? t("plugins.mcp.enabledCopy")
      : t("plugins.mcp.disabledCopy")

  return (
    <div className="plugins-mcp-controls">
      <div className="plugins-mcp-control-row">
        <span className="plugins-mcp-control-copy">
          <strong>{t("plugins.mcp.enable")}</strong>
          <small>{preferenceCopy}</small>
        </span>
        <button
          className={preferenceEnabled ? "plugins-mcp-switch is-active" : "plugins-mcp-switch"}
          type="button"
          role="switch"
          aria-checked={preferenceEnabled}
          aria-label={t("plugins.mcp.enableAria", { server: server.name ?? server.id })}
          disabled={controlsDisabled}
          onClick={() => void onEnabledChange(pluginID, server.id, !preferenceEnabled)}
        >
          <span aria-hidden="true" />
        </button>
      </div>

      <div className="plugins-connector-actions">
        <button
          className="plugins-detail-uninstall-button"
          type="button"
          disabled={diagnosticDisabled}
          onClick={() => void onDiagnose(server.id)}
        >
          {isDiagnosing ? t("plugins.mcp.checking") : t("plugins.mcp.diagnose")}
        </button>
      </div>

      {diagnostic?.error ? (
        <div className="settings-banner is-error" role="alert">{diagnostic.error}</div>
      ) : null}

      {diagnostic?.ok ? (
        <McpToolsPolicyPanel
          diagnostic={diagnostic}
          disabled={isSaving || !installed.enabled || !preferenceEnabled}
          draft={mcpToolPolicyDraftFromServer(server)}
          onPolicyChange={(toolName, policy) => {
            void onPolicyChange(pluginID, server.id, toolName, policy)
          }}
        />
      ) : null}
    </div>
  )
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
  return (
    plugin.mcpServers.length
    + plugin.mcpRequirements.length
    + plugin.skills.length
    + plugin.connectorRequirements.length
    + plugin.apps.length
  )
}

function pluginCategoryLabel(category: PluginCategory | "All", t: Translate) {
  return t(CATEGORY_LABEL_KEYS[category])
}

function pluginCapabilityLabel(plugin: PluginCatalogItem, t: Translate) {
  const count = pluginCapabilityCount(plugin)
  if (count > 0) {
    return t("plugins.capability.count", {
      count,
      label: count === 1 ? t("plugins.detail.capability") : t("plugins.detail.capabilities"),
    })
  }
  if (plugin.tools.length > 0) {
    return t("plugins.tools.count", {
      count: plugin.tools.length,
      plural: plugin.tools.length === 1 ? "" : "s",
    })
  }
  return t("plugins.capability.basic")
}

function pluginStoreSourceLabel(plugin: PluginCatalogItem, t: Translate) {
  if (plugin.source === "package") return t("plugins.source.package")
  if (plugin.source === "registry") return t("plugins.source.registry")
  return t("plugins.source.catalog")
}

function pluginPublisherLabel(publisher: string, t: Translate) {
  return t("plugins.publisher", { publisher })
}

function pluginVisibleStatus(installed: InstalledPlugin | null, t: Translate) {
  if (installed?.missingPackage) return t("plugins.status.packageMissing")
  if (!installed) return null
  return installed.enabled ? t("plugins.status.installed") : t("plugins.status.disabled")
}

function pluginInstallStateLabel(installed: InstalledPlugin | null, t: Translate) {
  if (installed?.missingPackage) return t("plugins.status.packageMissing")
  if (!installed) return t("plugins.status.notInstalled")
  return installed.enabled ? t("plugins.status.installedEnabled") : t("plugins.status.disabled")
}

function localizedPluginText(
  localized: Partial<Record<AppLocale, string>> | undefined,
  locale: AppLocale,
  fallback: string | undefined,
) {
  return localized?.[locale]?.trim() || fallback?.trim() || ""
}

function pluginDisplayName(plugin: PluginCatalogItem, locale: AppLocale) {
  return localizedPluginText(plugin.localized?.name, locale, plugin.name) || plugin.name
}

function pluginDisplayDescription(plugin: PluginCatalogItem, locale: AppLocale) {
  return localizedPluginText(plugin.localized?.description, locale, plugin.description) || plugin.description
}

function pluginDisplayLongDescription(plugin: PluginCatalogItem, locale: AppLocale) {
  return localizedPluginText(plugin.localized?.longDescription, locale, plugin.longDescription) ||
    localizedPluginText(plugin.localized?.description, locale, plugin.description)
}

function pluginSearchText(plugin: PluginCatalogItem, locale: AppLocale) {
  return [
    pluginDisplayName(plugin, locale),
    plugin.name,
    plugin.publisher,
    pluginDisplayDescription(plugin, locale),
    plugin.description,
    pluginDisplayLongDescription(plugin, locale),
    plugin.longDescription ?? "",
    ...Object.values(plugin.localized?.name ?? {}),
    ...Object.values(plugin.localized?.description ?? {}),
    ...Object.values(plugin.localized?.longDescription ?? {}),
    plugin.category,
    (plugin.tags ?? []).join(" "),
    plugin.tools.map((tool) => tool.name).join(" "),
    plugin.skills.map((skill) => skill.name).join(" "),
    plugin.mcpRequirements.map((requirement) => requirement.mcp).join(" "),
    plugin.connectorRequirements.map((requirement) => requirement.connector).join(" "),
    plugin.apps.map((app) => app.name).join(" "),
  ].join(" ")
}

function pluginDetailDescription(plugin: PluginCatalogItem, locale: AppLocale, t: Translate) {
  const longDescription = pluginDisplayLongDescription(plugin, locale)
  if (longDescription.trim()) return longDescription.trim()

  const description = pluginDisplayDescription(plugin, locale)

  const capabilityCount = pluginCapabilityCount(plugin)
  const capabilityLabel = capabilityCount === 1 ? t("plugins.detail.capability") : t("plugins.detail.capabilities")
  const category = locale === "en-US"
    ? pluginCategoryLabel(plugin.category, t).toLowerCase()
    : pluginCategoryLabel(plugin.category, t)

  return t("plugins.detail.generatedDescription", {
    description,
    count: capabilityCount,
    capabilityLabel,
    category,
  })
}

function pluginFunctionLabel(plugin: PluginCatalogItem) {
  const toolModes = new Set<string>(plugin.tools.map((tool) => (tool.readOnly ? "Read" : "Write")))
  if (plugin.connectorRequirements.length + plugin.apps.length > 0) toolModes.add("Interactive")
  if (plugin.mcpServers.length + plugin.mcpRequirements.length > 0) toolModes.add("MCP")
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
  t: Translate
  onCategoryChange: (category: PluginCategory | "All") => void
}

function PluginCategoryNavigation({
  activeCategory,
  categoryCounts,
  t,
  onCategoryChange,
}: PluginCategoryNavigationProps) {
  return (
    <nav className="plugins-marketplace-category-nav" aria-label={t("plugins.categories")}>
      {CATEGORY_FILTERS.map((category) => {
        const isActive = category === activeCategory
        const count = categoryCounts.get(category) ?? 0
        const label = pluginCategoryLabel(category, t)

        return (
          <button
            key={category}
            className={isActive ? "is-active" : undefined}
            type="button"
            aria-label={t("plugins.category.filterAria", {
              label,
              count,
              plural: count === 1 ? "" : "s",
            })}
            aria-pressed={isActive}
            onClick={() => onCategoryChange(category)}
          >
            <span>{label}</span>
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
  locale: AppLocale
  plugin: PluginCatalogItem
  t: Translate
  onInstallPlugin: (pluginID: string) => boolean | Promise<boolean>
  onPluginSelect: (pluginID: string) => void
}

function PluginMarketItem({
  canInstall,
  installed,
  isActive,
  isBusy,
  locale,
  plugin,
  t,
  onInstallPlugin,
  onPluginSelect,
}: PluginMarketItemProps) {
  const name = pluginDisplayName(plugin, locale)
  const description = pluginDisplayDescription(plugin, locale)
  const packageMissing = Boolean(installed?.missingPackage)
  const installState = pluginInstallStateLabel(installed, t)
  const visibleStatus = pluginVisibleStatus(installed, t)
  const tags = plugin.tags.slice(0, 2)
  const sourceLabel = pluginStoreSourceLabel(plugin, t)

  return (
    <div
      className={isActive ? "plugins-market-item is-active" : "plugins-market-item"}
      style={pluginBrandStyle(plugin)}
    >
      <button
        className="plugins-market-item-main"
        type="button"
        aria-label={`${name} ${installState}`}
        aria-pressed={isActive}
        onClick={() => onPluginSelect(plugin.id)}
      >
        <span className="plugins-market-item-mark">
          <PluginMark plugin={plugin} />
        </span>
        <span className="plugins-market-item-copy">
          <span className="plugins-market-item-title-row">
            <strong>{name}</strong>
            {visibleStatus ? <span className="plugins-market-item-state">{visibleStatus}</span> : null}
          </span>
          <span className="plugins-market-item-description">{description}</span>
          <span className="plugins-market-item-meta" aria-hidden="true">
            <span>{pluginPublisherLabel(plugin.publisher, t)}</span>
            <span>{pluginCategoryLabel(plugin.category, t)}</span>
            <span>{pluginCapabilityLabel(plugin, t)}</span>
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
            aria-label={`Install ${name}`}
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
  locale: AppLocale
  pluginCatalog: PluginCatalogItem[]
  selectedPluginID: string | null
  t: Translate
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

function installedPluginStatusText(installed: InstalledPlugin, t: Translate) {
  if (installed.missingPackage) return t("plugins.status.packageMissing")
  return installed.enabled ? t("plugins.sidebar.enabled") : t("plugins.status.disabled")
}

function installedPluginAriaStatus(installed: InstalledPlugin, t: Translate) {
  if (installed.missingPackage) return t("plugins.status.packageMissing")
  return installed.enabled ? t("plugins.status.installedEnabled") : t("plugins.status.disabled")
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
  t: Translate
  onClose: () => void
}

function InstalledPluginContextMenu({
  menu,
  t,
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
        <span className="ui-context-menu__label">{t("plugins.sidebar.openLocalFiles")}</span>
      </button>
    </div>,
    document.body,
  )
}

function InstalledPluginsSidebar({
  installedPlugins,
  locale,
  pluginCatalog,
  selectedPluginID,
  t,
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
        const leftName = left.plugin ? pluginDisplayName(left.plugin, locale) : installedPluginDisplayName(left.installed.pluginID)
        const rightName = right.plugin ? pluginDisplayName(right.plugin, locale) : installedPluginDisplayName(right.installed.pluginID)

        return leftName.localeCompare(rightName, locale)
      }),
    [catalogByPluginID, installedPlugins, locale],
  )

  function closeContextMenu() {
    setContextMenu(null)
  }

  return (
    <>
      <aside className="plugins-installed-sidebar" aria-label={t("plugins.sidebar.installedAria")}>
        <div className="plugins-installed-sidebar-header">
          <h2>{t("plugins.sidebar.installed")}</h2>
          <span>{installedPlugins.length}</span>
        </div>

        {installedRows.length > 0 ? (
          <div className="plugins-installed-list" role="list" aria-label={t("plugins.sidebar.installedList")}>
            {installedRows.map(({ installed, plugin }) => {
              const name = plugin ? pluginDisplayName(plugin, locale) : installedPluginDisplayName(installed.pluginID)
              const isActive = selectedPluginID === installed.pluginID
              const visibleStatus = installed.missingPackage || !installed.enabled ? installedPluginStatusText(installed, t) : null

              return (
                <div key={installed.pluginID} role="listitem">
                  <button
                    className={isActive ? "plugins-installed-item is-active" : "plugins-installed-item"}
                    type="button"
                    aria-label={`${name} ${installedPluginAriaStatus(installed, t)}`}
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
          <p className="plugins-installed-empty">{t("plugins.sidebar.empty")}</p>
        )}
      </aside>
      <InstalledPluginContextMenu menu={contextMenu} t={t} onClose={closeContextMenu} />
    </>
  )
}

type PluginSkillContextMenuState = {
  pluginID: string
  pluginName: string
  skill: PluginSkillPreview
  canBrowse: boolean
  trigger: HTMLButtonElement
  x: number
  y: number
} | null

type PluginSkillBrowserState = {
  pluginID: string
  pluginName: string
  skill: PluginSkillPreview
  trigger: HTMLButtonElement
} | null

interface PluginSkillContextMenuProps {
  menu: NonNullable<PluginSkillContextMenuState>
  t: Translate
  onBrowse: (menu: NonNullable<PluginSkillContextMenuState>) => void
  onClose: (restoreFocus?: boolean) => void
}

function PluginSkillContextMenu({
  menu,
  t,
  onBrowse,
  onClose,
}: PluginSkillContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const actionRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (menu.canBrowse) {
      actionRef.current?.focus()
    } else {
      menuRef.current?.focus()
    }

    function handlePointerDown(event: globalThis.PointerEvent) {
      const target = event.target as Node | null
      if (!target || menuRef.current?.contains(target)) return
      onClose()
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    function handleViewportChange() {
      onClose()
    }

    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    window.addEventListener("resize", handleViewportChange)
    window.addEventListener("scroll", handleViewportChange, true)

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("resize", handleViewportChange)
      window.removeEventListener("scroll", handleViewportChange, true)
    }
  }, [onClose])

  const position = clampInstalledPluginContextMenuPosition(menu.x, menu.y)

  return createPortal(
    <div
      ref={menuRef}
      className="ui-context-menu plugins-skill-context-menu"
      role="menu"
      aria-label={t("plugins.skill.menuAria", { skill: menu.skill.name })}
      tabIndex={-1}
      style={{ left: position.x, top: position.y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button
        ref={actionRef}
        className="ui-context-menu__item"
        role="menuitem"
        type="button"
        disabled={!menu.canBrowse}
        title={!menu.canBrowse ? t("plugins.skill.browseUnavailable") : undefined}
        onClick={() => {
          if (!menu.canBrowse) return
          onClose(false)
          onBrowse(menu)
        }}
      >
        <span className="ui-context-menu__icon" aria-hidden="true"><FolderOpenIcon /></span>
        <span className="ui-context-menu__label">{t("plugins.skill.browse")}</span>
      </button>
    </div>,
    document.body,
  )
}

interface PluginSectionProps {
  canInstallPlugin: (plugin: PluginCatalogItem) => boolean
  installedByPluginID: Map<string, InstalledPlugin>
  locale: AppLocale
  pluginBusyIDs: Set<string>
  plugins: PluginCatalogItem[]
  selectedPluginID: string | null
  t: Translate
  title: string
  onInstallPlugin: (pluginID: string) => boolean | Promise<boolean>
  onPluginSelect: (pluginID: string) => void
}

function PluginSection({
  canInstallPlugin,
  installedByPluginID,
  locale,
  pluginBusyIDs,
  plugins,
  selectedPluginID,
  t,
  title,
  onInstallPlugin,
  onPluginSelect,
}: PluginSectionProps) {
  if (plugins.length === 0) return null

  return (
    <section className="plugins-directory-section" aria-label={t("plugins.section.aria", { title })}>
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
                locale={locale}
                plugin={plugin}
                t={t}
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
  diagnosingMcpServerID,
  diagnosingPluginID,
  installingPluginID,
  installedPlugins,
  hideTopMenu = false,
  isLoading,
  loadError,
  pluginCatalog,
  pluginConnectorStatuses,
  mcpDiagnostics,
  mcpServers,
  searchQuery,
  updatingPluginID,
  windowControls,
  diagnosingPluginConnectorID,
  pluginDraft,
  savingPluginConnectorID,
  savingMcpServerID,
  onCancelInstalledPluginConnectorAuthFlow,
  onDeleteInstalledPlugin,
  onDeleteInstalledPluginConnectorApiKey,
  onDeleteInstalledPluginConnectorAuthSession,
  onDiagnoseInstalledPluginConnector,
  onDiagnoseMcpServer,
  onImportPluginFromURL,
  onInstallPlugin,
  onPluginDraftAppApiKeyChange,
  onPluginDraftConfigChange,
  onPluginDeselect,
  onPluginSelect,
  onSaveInstalledPluginConnectorApiKey,
  onSaveInstalledPluginConfig,
  onSetInstalledPluginEnabled,
  onSetInstalledPluginMcpEnabled,
  onSetInstalledPluginMcpToolPolicy,
  onManageConnector,
  onManageMcpServer,
  onStartInstalledPluginConnectorAuthFlow,
}: PluginsPageProps) {
  const { locale, t } = useI18n()
  const [categoryFilter, setCategoryFilter] = useState<PluginCategory | "All">("All")
  const [expandedIncludedItemID, setExpandedIncludedItemID] = useState<string | null>(null)
  const [isImportURLDialogOpen, setIsImportURLDialogOpen] = useState(false)
  const [pluginImportURL, setPluginImportURL] = useState("")
  const [pluginImportError, setPluginImportError] = useState<string | null>(null)
  const [isImportingPluginURL, setIsImportingPluginURL] = useState(false)
  const [skillContextMenu, setSkillContextMenu] = useState<PluginSkillContextMenuState>(null)
  const [skillBrowser, setSkillBrowser] = useState<PluginSkillBrowserState>(null)
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

      return pluginSearchText(plugin, locale)
        .toLowerCase()
        .includes(normalizedQuery)
    })
  }, [categoryFilter, pluginCatalog, effectiveSearchQuery, locale])

  const activePlugin = activePluginID ? pluginCatalog.find((plugin) => plugin.id === activePluginID) ?? null : null
  const activePluginName = activePlugin ? pluginDisplayName(activePlugin, locale) : ""
  const activePluginDescription = activePlugin ? pluginDisplayDescription(activePlugin, locale) : ""
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
    ? t("plugins.installing")
    : activeInstalledPlugin?.missingPackage ? t("plugins.downloadAgain") : t("plugins.install")
  const activePluginUninstallLabel = activePlugin && deletingPluginID === activePlugin.id
    ? t("plugins.uninstalling")
    : t("plugins.uninstall")
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
  const pluginsTitle = t("plugins.title")
  const defaultOAuthApp = activePlugin?.apps.find((app) => app.credential.kind === "oauth")
  const defaultIncludedItemID = activePlugin && defaultOAuthApp
    ? `${activePlugin.id}:app:${defaultOAuthApp.appID}`
    : null
  const pluginBreadcrumb = activePlugin ? (
    <nav className="plugins-detail-breadcrumb" aria-label={t("plugins.detail.breadcrumb")}>
      <button type="button" onClick={onPluginDeselect}>
        <BackIcon />
        <span>{pluginsTitle}</span>
      </button>
    </nav>
  ) : null
  const toggleIncludedItem = (itemID: string) => {
    setExpandedIncludedItemID((currentItemID) => currentItemID === itemID ? null : itemID)
  }
  const closeSkillContextMenu = useCallback((restoreFocus = true) => {
    const trigger = skillContextMenu?.trigger
    setSkillContextMenu(null)
    if (restoreFocus && trigger) {
      window.requestAnimationFrame(() => trigger.focus())
    }
  }, [skillContextMenu])
  const openSkillBrowser = useCallback((menu: NonNullable<PluginSkillContextMenuState>) => {
    setSkillBrowser({
      pluginID: menu.pluginID,
      pluginName: menu.pluginName,
      skill: menu.skill,
      trigger: menu.trigger,
    })
  }, [])
  const closeSkillBrowser = useCallback(() => {
    const trigger = skillBrowser?.trigger
    setSkillBrowser(null)
    if (trigger) {
      window.requestAnimationFrame(() => trigger.focus())
    }
  }, [skillBrowser])
  const openImportURLDialog = () => {
    setPluginImportError(null)
    setIsImportURLDialogOpen(true)
  }
  const closeImportURLDialog = () => {
    if (isImportingPluginURL) return
    setIsImportURLDialogOpen(false)
    setPluginImportError(null)
  }
  const handleImportURLSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedURL = pluginImportURL.trim()
    if (!trimmedURL) {
      setPluginImportError(t("plugins.importUrl.required"))
      return
    }

    setIsImportingPluginURL(true)
    setPluginImportError(null)
    try {
      const imported = await onImportPluginFromURL(trimmedURL)
      if (imported) {
        setIsImportURLDialogOpen(false)
        setPluginImportURL("")
      } else {
        setPluginImportError(t("plugins.importUrl.failed"))
      }
    } catch (error) {
      setPluginImportError(error instanceof Error ? error.message : t("plugins.importUrl.failed"))
    } finally {
      setIsImportingPluginURL(false)
    }
  }
  const importURLDialog = isImportURLDialogOpen
    ? createPortal(
      <section
        className="plugins-import-url-overlay"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeImportURLDialog()
        }}
      >
        <form
          className="plugins-import-url-dialog"
          role="dialog"
          aria-modal="true"
          aria-label={t("plugins.importUrl.title")}
          onSubmit={handleImportURLSubmit}
        >
          <header className="plugins-import-url-header">
            <div>
              <span>{t("plugins.importUrl.eyebrow")}</span>
              <h2>{t("plugins.importUrl.title")}</h2>
              <p>{t("plugins.importUrl.copy")}</p>
            </div>
            <button
              className="plugins-import-url-close"
              type="button"
              aria-label={t("plugins.importUrl.close")}
              disabled={isImportingPluginURL}
              onClick={closeImportURLDialog}
            >
              <CloseIcon />
            </button>
          </header>
          <label className="plugins-import-url-field">
            <span>{t("plugins.importUrl.field")}</span>
            <input
              type="url"
              value={pluginImportURL}
              placeholder="https://example.com/.anybox-plugin/plugin.json"
              autoFocus
              aria-invalid={Boolean(pluginImportError)}
              disabled={isImportingPluginURL}
              onChange={(event) => {
                setPluginImportURL(event.target.value)
                if (pluginImportError) setPluginImportError(null)
              }}
            />
          </label>
          {pluginImportError ? (
            <p className="plugins-import-url-error" role="alert">{pluginImportError}</p>
          ) : null}
          <footer className="plugins-import-url-actions">
            <button
              className="plugins-import-url-secondary-button"
              type="button"
              disabled={isImportingPluginURL}
              onClick={closeImportURLDialog}
            >
              {t("app.cancel")}
            </button>
            <button
              className="plugins-import-url-primary-button"
              type="submit"
              disabled={isImportingPluginURL || pluginImportURL.trim().length === 0}
            >
              {isImportingPluginURL ? t("app.importing") : t("plugins.importUrl.submit")}
            </button>
          </footer>
        </form>
      </section>,
      document.body,
    )
    : null

  useEffect(() => {
    setExpandedIncludedItemID(defaultIncludedItemID)
  }, [defaultIncludedItemID])

  useEffect(() => {
    setSkillContextMenu(null)
    setSkillBrowser(null)
  }, [activePluginID])

  return (
    <section className={hideTopMenu ? "plugins-page is-embedded" : "plugins-page"} aria-label={pluginsTitle}>
      {!hideTopMenu ? (
        <ShellTopMenu
          as="header"
          ariaLabel={t("plugins.topMenu")}
          className="canvas-region-top-menu plugins-top-menu"
          contentClassName="plugins-top-menu-actions-shell"
          content={(
            <div className="plugins-top-menu-actions">
              {activePlugin ? (
                null
              ) : (
                <button className="plugins-top-menu-button" type="button" disabled>
                  <SettingsIcon />
                  <span>{t("plugins.manage")}</span>
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
            <h3>{t("plugins.loadingTitle")}</h3>
            <p>{t("plugins.loadingCopy")}</p>
          </article>
        ) : (
          <div className={isPluginDetailView ? "plugins-marketplace-shell is-detail-view" : "plugins-marketplace-shell"}>
            <div className="settings-service-list-panel plugins-list-panel plugins-marketplace-sidebar-column">
              <InstalledPluginsSidebar
                installedPlugins={installedPlugins}
                locale={locale}
                pluginCatalog={pluginCatalog}
                selectedPluginID={selectedPluginID}
                t={t}
                onPluginSelect={onPluginSelect}
              />
            </div>

            <div className={isPluginDetailView ? "settings-service-detail-panel plugins-marketplace-content is-detail-view" : "settings-service-detail-panel plugins-marketplace-content"}>
              {pluginBreadcrumb}
              {!activePlugin ? (
              <>
                <div className="plugins-directory-toolbar">
                  <PluginCategoryNavigation
                    activeCategory={categoryFilter}
                    categoryCounts={categoryCounts}
                    t={t}
                    onCategoryChange={setCategoryFilter}
                  />
                  <button className="plugins-import-url-trigger" type="button" onClick={openImportURLDialog}>
                    <OpenExternalIcon />
                    <span>{t("plugins.importUrl.action")}</span>
                  </button>
                </div>

                <div className="plugins-directory" role="region" aria-label={t("plugins.marketplaceLayout")}>
                  {hasPluginMatches ? (
                    <>
                      {shouldShowFeatured ? (
                        <PluginSection
                          canInstallPlugin={canInstallPlugin}
                          installedByPluginID={installedByPluginID}
                          locale={locale}
                          pluginBusyIDs={pluginBusyIDs}
                          plugins={featuredPlugins}
                          selectedPluginID={selectedPluginID}
                          t={t}
                          title={t("plugins.featured")}
                          onInstallPlugin={onInstallPlugin}
                          onPluginSelect={onPluginSelect}
                        />
                      ) : null}

                      {directorySections.map(({ category, items }) => (
                        <PluginSection
                          key={category}
                          canInstallPlugin={canInstallPlugin}
                          installedByPluginID={installedByPluginID}
                          locale={locale}
                          pluginBusyIDs={pluginBusyIDs}
                          plugins={items}
                          selectedPluginID={selectedPluginID}
                          t={t}
                          title={pluginCategoryLabel(category, t)}
                          onInstallPlugin={onInstallPlugin}
                          onPluginSelect={onPluginSelect}
                        />
                      ))}
                    </>
                  ) : (
                    <article className="settings-empty-state plugins-directory-empty-state">
                      <span className="label">{t("plugins.noMatches")}</span>
                      <h3>{t("plugins.noMatchesTitle")}</h3>
                      <p>{t("plugins.noMatchesCopy")}</p>
                    </article>
                  )}
                </div>
              </>
            ) : null}

            {activePlugin ? (
              <section className="plugins-management-detail" aria-label={t("plugins.detail.selectedDetails")}>
                <>
                  <header className="plugins-detail-header">
                    <PluginMark plugin={activePlugin} />
                    <h1>{activePluginName}</h1>
                    <p>{activePluginDescription}</p>
                    {(activePlugin.tags ?? []).length > 0 ? (
                      <div className="plugins-tag-row" aria-label={`${activePluginName} tags`}>
                        {(activePlugin.tags ?? []).slice(0, 8).map((tag) => (
                          <span key={tag} className="settings-badge">{tag}</span>
                        ))}
                      </div>
                    ) : null}
                  </header>

                  <p className="plugins-detail-description">{pluginDetailDescription(activePlugin, locale, t)}</p>

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
                            alt={`${activePluginName} screenshot ${index + 1}`}
                          />
                        ))}
                      </div>
                    </section>
                  ) : null}

                  <section className="plugins-detail-section">
                    <h2>{t("plugins.detail.included")}</h2>
                    <div className="plugins-included-card">
                      {activePlugin.skills.map((skill) => {
                        const itemID = `${activePlugin.id}:skill:${skill.id}`
                        const isExpanded = expandedIncludedItemID === itemID
                        const statusLabel = activeInstalledPlugin
                          ? installedPluginStatusText(activeInstalledPlugin, t)
                          : t("plugins.status.notInstalled")
                        const statusClassName = activeInstalledPlugin
                          ? installedPluginStatusClassName(activeInstalledPlugin)
                          : "is-not-installed"
                        const canBrowseSkill = Boolean(activeInstalledPlugin && !activeInstalledPlugin.missingPackage)
                        const openSkillContextMenu = (
                          trigger: HTMLButtonElement,
                          x: number,
                          y: number,
                        ) => {
                          setSkillContextMenu({
                            pluginID: activePlugin.id,
                            pluginName: activePluginName,
                            skill,
                            canBrowse: canBrowseSkill,
                            trigger,
                            x,
                            y,
                          })
                        }

                        return (
                          <div key={`skill:${skill.id}`} className="plugins-included-item">
                            <button
                              className={isExpanded ? "plugins-included-row is-expanded" : "plugins-included-row"}
                              type="button"
                              aria-expanded={isExpanded}
                              aria-controls={`${itemID}:detail`}
                              aria-label={`Show details for ${skill.name}`}
                              onClick={() => toggleIncludedItem(itemID)}
                              onContextMenu={(event) => {
                                event.preventDefault()
                                event.stopPropagation()
                                openSkillContextMenu(
                                  event.currentTarget,
                                  event.clientX,
                                  event.clientY,
                                )
                              }}
                              onKeyDown={(event) => {
                                if ((event.shiftKey && event.key === "F10") || event.key === "ContextMenu") {
                                  event.preventDefault()
                                  const rect = event.currentTarget.getBoundingClientRect()
                                  openSkillContextMenu(
                                    event.currentTarget,
                                    rect.left + 20,
                                    rect.top + 20,
                                  )
                                }
                              }}
                            >
                              <span className="plugins-included-icon"><SkillIcon /></span>
                              <span className="plugins-included-copy">
                                <strong>{skill.name}</strong>
                                <span>{skill.description}</span>
                              </span>
                              <span
                                className={joinClassNames("plugins-included-status-dot", statusClassName)}
                                role="img"
                                aria-label={`Status: ${statusLabel}`}
                                title={statusLabel}
                              />
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
                                <div className="plugins-skill-detail-actions">
                                  <button
                                    className="secondary-button plugins-skill-browse-button"
                                    type="button"
                                    disabled={!canBrowseSkill}
                                    title={!canBrowseSkill ? t("plugins.skill.browseUnavailable") : undefined}
                                    onClick={(event) => {
                                      setSkillBrowser({
                                        pluginID: activePlugin.id,
                                        pluginName: activePluginName,
                                        skill,
                                        trigger: event.currentTarget,
                                      })
                                    }}
                                  >
                                    <FolderOpenIcon />
                                    <span>{t("plugins.skill.browse")}</span>
                                  </button>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        )
                      })}
                      {activePlugin.mcpServers.map((server) => {
                        const itemID = `${activePlugin.id}:mcp:${server.id}`
                        const isExpanded = expandedIncludedItemID === itemID
                        const serverID = generatedServerID(activePlugin, server)
                        const mcpServer = findPluginMcpServer(
                          mcpServers,
                          activeInstalledPlugin,
                          activePlugin.id,
                          `mcp:${server.id}`,
                          serverID,
                        )
                        const preferenceEnabled = activeInstalledPlugin?.mcpServerEnabled[serverID] ?? true
                        const statusLabel = !activeInstalledPlugin
                          ? t("plugins.status.notInstalled")
                          : !mcpServer
                            ? t("plugins.mcp.bindingMissing")
                            : !activeInstalledPlugin.enabled
                              ? t("plugins.status.disabled")
                              : preferenceEnabled
                                ? t("app.enabled")
                                : t("app.disabled")
                        const statusClassName = !activeInstalledPlugin
                          ? "is-not-installed"
                          : !mcpServer
                            ? "is-error"
                            : activeInstalledPlugin.enabled && preferenceEnabled
                              ? "is-enabled"
                              : "is-unavailable"

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
                              <span className="plugins-included-icon"><McpIcon /></span>
                              <span className="plugins-included-copy">
                                <strong>{server.name}</strong>
                                <span>{runtimeTitle(server.runtime)}</span>
                              </span>
                              <span
                                className={joinClassNames("plugins-included-status-dot", statusClassName)}
                                role="img"
                                aria-label={`Status: ${statusLabel}`}
                                title={statusLabel}
                              />
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
                                    <dd>{serverID}</dd>
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
                                <PluginMcpControls
                                  diagnostic={mcpServer ? mcpDiagnostics[mcpServer.id] ?? null : null}
                                  installed={activeInstalledPlugin}
                                  isDiagnosing={Boolean(mcpServer && diagnosingMcpServerID === mcpServer.id)}
                                  isSaving={Boolean(mcpServer && savingMcpServerID === mcpServer.id)}
                                  pluginID={activePlugin.id}
                                  server={mcpServer}
                                  t={t}
                                  onDiagnose={onDiagnoseMcpServer}
                                  onEnabledChange={onSetInstalledPluginMcpEnabled}
                                  onPolicyChange={onSetInstalledPluginMcpToolPolicy}
                                  onRepair={() => onInstallPlugin(activePlugin.id)}
                                />
                              </div>
                            ) : null}
                          </div>
                        )
                      })}
                      {activePlugin.apps.map((app) => {
                        const itemID = `${activePlugin.id}:app:${app.appID}`
                        const isExpanded = expandedIncludedItemID === itemID
                        const status = activeConnectorStatusByAppID.get(app.appID)
                        const fallbackServerID = status?.generatedMcpServerID ?? generatedAppServerID(activePlugin, app.appID)
                        const mcpServer = findPluginMcpServer(
                          mcpServers,
                          activeInstalledPlugin,
                          activePlugin.id,
                          `app:${app.appID}`,
                          fallbackServerID,
                        )
                        const preferenceEnabled = activeInstalledPlugin?.mcpServerEnabled[mcpServer?.id ?? fallbackServerID] ?? true
                        const statusLabel = !activeInstalledPlugin
                          ? t("plugins.status.notInstalled")
                          : !mcpServer
                            ? t("plugins.mcp.bindingMissing")
                            : !activeInstalledPlugin.enabled || !preferenceEnabled
                              ? t("app.disabled")
                              : connectorStatusLabel(status)
                        const connectorKey = `${activePlugin.id}:${app.appID}`
                        const credentialKind = app.credential.kind === "oauth" ? "oauth" : "api_key"
                        const apiKeyCredential = app.credential.kind === "oauth" ? null : app.credential
                        const isBusy = savingPluginConnectorID === connectorKey
                        const isDiagnosing = diagnosingPluginConnectorID === connectorKey
                        const activeFlow = status?.activeFlow
                        const hasPendingFlow = activeFlow && ["pending", "waiting_user", "authorizing"].includes(activeFlow.status)
                        const appSummary = activeInstalledPlugin
                          ? `${statusLabel} - ${app.description ?? "Connector-backed MCP"}`
                          : `Install to enable ${credentialKindLabel(credentialKind)}`
                        const statusDotClassName = !activeInstalledPlugin
                          ? "is-not-installed"
                          : !mcpServer
                            ? "is-error"
                            : !activeInstalledPlugin.enabled || !preferenceEnabled
                              ? "is-unavailable"
                              : connectorStatusDotClassName(status)

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
                              <span
                                className={joinClassNames("plugins-included-status-dot", statusDotClassName)}
                                role="img"
                                aria-label={`Status: ${statusLabel}`}
                                title={statusLabel}
                              />
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
                                    <dt>MCP server</dt>
                                    <dd>{mcpServer?.id ?? fallbackServerID}</dd>
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
                                <PluginMcpControls
                                  diagnostic={mcpServer ? mcpDiagnostics[mcpServer.id] ?? null : null}
                                  installed={activeInstalledPlugin}
                                  isDiagnosing={Boolean(mcpServer && diagnosingMcpServerID === mcpServer.id)}
                                  isSaving={Boolean(mcpServer && savingMcpServerID === mcpServer.id)}
                                  pluginID={activePlugin.id}
                                  server={mcpServer}
                                  t={t}
                                  onDiagnose={onDiagnoseMcpServer}
                                  onEnabledChange={onSetInstalledPluginMcpEnabled}
                                  onPolicyChange={onSetInstalledPluginMcpToolPolicy}
                                  onRepair={() => onInstallPlugin(activePlugin.id)}
                                />
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
                      {activePlugin.mcpRequirements.map((requirement) => {
                        const itemID = `${activePlugin.id}:mcp-requirement:${requirement.mcp}`
                        const isExpanded = expandedIncludedItemID === itemID
                        const mcpServerID = `anybox.${requirement.mcp}`
                        const mcpServer = mcpServers.find((server) =>
                          matchesAnyboxMcpRequirement(server, requirement.mcp),
                        )
                        const statusLabel = !mcpServer
                          ? "Unavailable"
                          : mcpServer.enabled
                            ? t("app.enabled")
                            : t("app.disabled")
                        const statusClassName = !mcpServer
                          ? "is-error"
                          : mcpServer.enabled
                            ? "is-enabled"
                            : "is-unavailable"
                        const requestedTools = requirement.tools?.join(", ") || "Declared by Anybox MCP"
                        const requestedPermissions = requirement.permissions?.join(", ") || "Declared by Anybox MCP"

                        return (
                          <div key={`mcp-requirement:${requirement.mcp}`} className="plugins-included-item">
                            <button
                              className={isExpanded ? "plugins-included-row is-expanded" : "plugins-included-row"}
                              type="button"
                              aria-expanded={isExpanded}
                              aria-controls={`${itemID}:detail`}
                              aria-label={`Show details for ${requirement.mcp}`}
                              onClick={() => toggleIncludedItem(itemID)}
                            >
                              <span className="plugins-included-icon"><McpIcon /></span>
                              <span className="plugins-included-copy">
                                <strong>{mcpServer?.name ?? requirement.mcp}</strong>
                                <span>{requirement.reason ?? "Anybox built-in MCP requirement"}</span>
                              </span>
                              <span
                                className={joinClassNames("plugins-included-status-dot", statusClassName)}
                                role="img"
                                aria-label={`Status: ${statusLabel}`}
                                title={statusLabel}
                              />
                              <span className="plugins-included-chevron" aria-hidden="true"><ChevronDownIcon /></span>
                            </button>
                            {isExpanded ? (
                              <div className="plugins-included-detail" id={`${itemID}:detail`}>
                                <dl className="plugins-included-detail-grid">
                                  <div>
                                    <dt>Type</dt>
                                    <dd>Anybox built-in MCP</dd>
                                  </div>
                                  <div>
                                    <dt>{t("mcp.title")}</dt>
                                    <dd>{requirement.mcp}</dd>
                                  </div>
                                  <div>
                                    <dt>Status</dt>
                                    <dd>{statusLabel}</dd>
                                  </div>
                                  <div>
                                    <dt>MCP server ID</dt>
                                    <dd>{mcpServer?.id ?? mcpServerID}</dd>
                                  </div>
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
                                {mcpServer && onManageMcpServer ? (
                                  <div className="plugins-connector-actions">
                                    <button
                                      className="plugins-detail-uninstall-button"
                                      type="button"
                                      onClick={() => onManageMcpServer(mcpServer.id)}
                                    >
                                      {t("plugins.mcp.manage")}
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        )
                      })}
                      {activePlugin.connectorRequirements.map((requirement) => {
                        const itemID = `${activePlugin.id}:connector-requirement:${requirement.connector}`
                        const isExpanded = expandedIncludedItemID === itemID
                        const status = platformConnectorStatusByDefinitionID.get(requirement.connector)
                        const statusLabel = connectorStatusLabel(status)
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
                              <span
                                className={joinClassNames("plugins-included-status-dot", connectorStatusDotClassName(status))}
                                role="img"
                                aria-label={`Status: ${statusLabel}`}
                                title={statusLabel}
                              />
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
                                      <dt>{t("mcp.title")}</dt>
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
                                {onManageConnector ? (
                                  <div className="plugins-connector-actions">
                                    <button
                                      className="plugins-detail-uninstall-button"
                                      type="button"
                                      onClick={() => onManageConnector(connectorID)}
                                    >
                                      {t("plugins.connector.manage")}
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        )
                      })}
                    </div>
                  </section>

                  <section className="plugins-detail-section">
                    <h2>{t("plugins.detail.info")}</h2>
                    <div className="plugins-info-table">
                      <div>
                        <span>{t("plugins.detail.category")}</span>
                        <strong>{pluginPublisherLabel(activePlugin.publisher, t)} · {pluginCategoryLabel(activePlugin.category, t)}</strong>
                      </div>
                      <div>
                        <span>{t("plugins.detail.function")}</span>
                        <strong>{pluginFunctionLabel(activePlugin)}</strong>
                      </div>
                      <div>
                        <span>{t("plugins.detail.developer")}</span>
                        <strong>{activePlugin.publisher}</strong>
                      </div>
                      <div>
                        <span>{t("plugins.detail.version")}</span>
                        <strong>{activePlugin.version}</strong>
                      </div>
                      <div>
                        <span>{t("plugins.detail.website")}</span>
                        {activePlugin.homepage ? (
                          <a
                            className="plugins-info-link"
                            href={activePlugin.homepage}
                            target="_blank"
                            rel="noreferrer"
                            title={`Open ${activePluginName} website`}
                            onClick={(event) => handlePluginInfoLinkClick(event, activePlugin.homepage!)}
                          >
                            <span className="plugins-info-link-text">{activePlugin.homepage}</span>
                            <OpenExternalIcon />
                          </a>
                        ) : (
                          <strong>{t("plugins.detail.notProvided")}</strong>
                        )}
                      </div>
                      <div>
                        <span>{t("plugins.detail.documentation")}</span>
                        {activePlugin.documentationUrl ? (
                          <a
                            className="plugins-info-link"
                            href={activePlugin.documentationUrl}
                            target="_blank"
                            rel="noreferrer"
                            title={`Open ${activePluginName} documentation`}
                            onClick={(event) => handlePluginInfoLinkClick(event, activePlugin.documentationUrl!)}
                          >
                            <span className="plugins-info-link-text">{activePlugin.documentationUrl}</span>
                            <OpenExternalIcon />
                          </a>
                        ) : (
                          <strong>{t("plugins.detail.notProvided")}</strong>
                        )}
                      </div>
                      <div>
                        <span>{t("plugins.detail.risk")}</span>
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
                    <div className="plugins-detail-actions" aria-label={`${activePluginName} plugin actions`}>
                      {activeInstalledPlugin && !activeInstalledPlugin.missingPackage ? (
                        <>
                          <div className="plugins-master-toggle">
                            <span>
                              <strong>{t("plugins.detail.masterEnable")}</strong>
                              <small>
                                {activeInstalledPlugin.enabled
                                  ? t("plugins.detail.masterEnableCopy")
                                  : t("plugins.detail.masterDisabledCopy")}
                              </small>
                            </span>
                            <button
                              className={activeInstalledPlugin.enabled
                                ? "plugins-mcp-switch is-active"
                                : "plugins-mcp-switch"}
                              type="button"
                              role="switch"
                              aria-checked={activeInstalledPlugin.enabled}
                              aria-label={t("plugins.detail.masterEnableAria", { plugin: activePluginName })}
                              disabled={pluginBusyIDs.has(activePlugin.id)}
                              onClick={() => {
                                void onSetInstalledPluginEnabled(activePlugin.id, !activeInstalledPlugin.enabled)
                              }}
                            >
                              <span aria-hidden="true" />
                            </button>
                          </div>
                          <span className="plugins-detail-action-status" aria-label={`${activePluginName} installed`}>
                            <ConnectedStatusIcon />
                            <span>{activeInstalledPlugin.enabled ? "Installed" : "Disabled"}</span>
                          </span>
                          <button
                            className="plugins-detail-uninstall-button"
                            type="button"
                            aria-label={`Uninstall ${activePluginName}`}
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
                          aria-label={`Install ${activePluginName}`}
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
      {importURLDialog}
      {skillContextMenu ? (
        <PluginSkillContextMenu
          menu={skillContextMenu}
          t={t}
          onBrowse={openSkillBrowser}
          onClose={closeSkillContextMenu}
        />
      ) : null}
      {skillBrowser ? (
        <PluginSkillBrowserPanel
          pluginID={skillBrowser.pluginID}
          pluginName={skillBrowser.pluginName}
          skill={skillBrowser.skill}
          onClose={closeSkillBrowser}
        />
      ) : null}
    </section>
  )
}
