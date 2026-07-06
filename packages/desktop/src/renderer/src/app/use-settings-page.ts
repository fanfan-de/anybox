import { useCallback, useEffect, useRef, useState } from "react"
import type {
  ArchivedSessionSummary,
  BuiltinToolSelection,
  BuiltinToolSummary,
  ConnectorDefinition,
  ConnectorStatus,
  CinemaVideoProvider,
  CinemaVideoProviderDraftState,
  CustomProviderDraftState,
  InstalledPlugin,
  LoadedSessionSnapshot,
  McpAllowedTools,
  McpServerDiagnostic,
  McpServerDraftState,
  McpServerSummary,
  McpToolPolicies,
  McpToolPolicyValue,
  ModelCatalogItem,
  PluginCatalogItem,
  PluginConnectorStatus,
  PluginDraftState,
  ProjectModelSelection,
  PromptPresetDocument,
  PromptPresetSelection,
  PromptPresetSummary,
  PromptTranslationLanguageID,
  PromptUrlInstallPreview,
  ProviderAuthCapability,
  ProviderAuthFlow,
  ProviderCatalogItem,
  ProviderDraftState,
  ProviderModel,
} from "./types"
import { mergeMcpToolPolicyDefaults } from "./mcp/mcp-tool-policies"
import { parseMcpConfigJson } from "./mcp/mcp-config-import"
import { arePluginCatalogsEqual, mergePluginCatalogWithInstalled } from "./plugin-catalog"
import { useToast } from "./toast"
import { useI18n } from "./i18n/I18nProvider"
import type { DesktopProviderAuthPrompt } from "../../../shared/desktop-ipc-contract"

interface SettingsMessage {
  tone: "success" | "error"
  text: string
}

interface LoadSettingsOptions {
  silent?: boolean
  preserveProviderDrafts?: boolean
}

interface UseSettingsPageOptions {
  isBuiltinToolsPageOpen?: boolean
  isConnectorsPageOpen?: boolean
  isMcpServersPageOpen?: boolean
  isPluginsPageOpen?: boolean
  isPromptPresetEditorOpen?: boolean
  onArchivedSessionRestored?: (session: LoadedSessionSnapshot) => void | Promise<void>
  onMcpUpdated?: () => void | Promise<void>
  onSkillsUpdated?: () => void | Promise<void>
  onProviderModelsUpdated?: () => void | Promise<void>
}

type ProviderMutationPayload = {
  name?: string
  env?: string[]
  options?: {
    baseURL?: string
  }
}

const defaultCustomProviderDraft: CustomProviderDraftState = {
  apiBaseURL: "",
  apiKey: "",
  defaultModel: "",
  chatEndpoint: "/chat/completions",
}

function normalizeSelection(selection?: {
  model?: string
  small_model?: string
  image_model?: string
  image_generation?: {
    default_size?: string
    default_count?: number
  }
  reasoning_effort?: ProjectModelSelection["reasoningEffort"]
}): ProjectModelSelection {
  return {
    model: selection?.model ?? null,
    smallModel: selection?.small_model ?? null,
    reasoningEffort: selection?.reasoning_effort ?? null,
    imageModel: selection?.image_model ?? null,
    imageDefaultSize: selection?.image_generation?.default_size ?? null,
    imageDefaultCount: selection?.image_generation?.default_count ?? null,
  }
}

const EMPTY_BUILTIN_TOOL_SELECTION: BuiltinToolSelection = { tools: {} }
const EMPTY_PROJECT_MODEL_SELECTION: ProjectModelSelection = {
  model: null,
  smallModel: null,
  reasoningEffort: null,
  imageModel: null,
  imageDefaultSize: null,
  imageDefaultCount: null,
}
const ANYBOX_ACCOUNT_PROVIDER_ID = "anybox"
const ANYBOX_BROWSER_AUTH_METHOD = "anybox-browser"
const CINEMA_VIDEO_PROVIDER_TEST_PREFIX = "cinema-video:"

export function buildModelSelectionUpdatePayload(
  savedSelection: ProjectModelSelection,
  nextSelection: ProjectModelSelection,
) {
  const imageGenerationChanged =
    savedSelection.imageDefaultSize !== nextSelection.imageDefaultSize ||
    savedSelection.imageDefaultCount !== nextSelection.imageDefaultCount
  const nextImageGeneration = {
    ...(nextSelection.imageDefaultSize ? { default_size: nextSelection.imageDefaultSize } : {}),
    ...(nextSelection.imageDefaultCount ? { default_count: nextSelection.imageDefaultCount } : {}),
  }

  return {
    ...(savedSelection.model !== nextSelection.model ? { model: nextSelection.model } : {}),
    ...(savedSelection.smallModel !== nextSelection.smallModel ? { small_model: nextSelection.smallModel } : {}),
    ...(savedSelection.reasoningEffort !== nextSelection.reasoningEffort
      ? { reasoning_effort: nextSelection.reasoningEffort }
      : {}),
    ...(savedSelection.imageModel !== nextSelection.imageModel ? { image_model: nextSelection.imageModel } : {}),
    ...(imageGenerationChanged
      ? { image_generation: Object.keys(nextImageGeneration).length > 0 ? nextImageGeneration : null }
      : {}),
  }
}

function normalizeBuiltinToolSelection(selection?: BuiltinToolSelection | null): BuiltinToolSelection {
  return {
    tools: { ...(selection?.tools ?? {}) },
  }
}

function resolveBuiltinToolEnabled(tool: BuiltinToolSummary, selection: BuiltinToolSelection) {
  const explicitStates = [tool.id, ...tool.aliases]
    .map((name) => selection.tools[name])
    .filter((value): value is boolean => typeof value === "boolean")

  return !explicitStates.includes(false)
}

function applyBuiltinToolSelection(
  items: BuiltinToolSummary[],
  selection: BuiltinToolSelection,
) {
  return items.map((tool) => ({
    ...tool,
    enabled: resolveBuiltinToolEnabled(tool, selection),
  }))
}

function stableSelectionKey(selection: BuiltinToolSelection) {
  return JSON.stringify([...Object.entries(selection.tools)].sort(([left], [right]) => left.localeCompare(right)))
}

function buildProviderDrafts(items: ProviderCatalogItem[]) {
  return items.reduce<Record<string, ProviderDraftState>>((result, item) => {
    result[item.id] = {
      apiKey: "",
      baseURL: item.baseURL ?? "",
      selectedAuthMethod: item.authState.activeMethod ?? item.authCapabilities[0]?.method ?? null,
      activeFlow: item.authState.flow ?? null,
    }
    return result
  }, {})
}

function buildCinemaVideoProviderDrafts(items: CinemaVideoProvider[]) {
  return items.reduce<Record<string, CinemaVideoProviderDraftState>>((result, item) => {
    result[item.manifest.id] = {
      apiKey: "",
      baseURL: item.runtime?.configuredBaseURL ?? "",
    }
    return result
  }, {})
}

function mergeCinemaVideoProviderDrafts(
  defaults: Record<string, CinemaVideoProviderDraftState>,
  current: Record<string, CinemaVideoProviderDraftState>,
) {
  return Object.fromEntries(
    Object.entries(defaults).map(([providerID, draft]) => {
      const currentDraft = current[providerID]
      return [
        providerID,
        {
          ...draft,
          apiKey: currentDraft?.apiKey ?? draft.apiKey,
          baseURL: currentDraft?.baseURL ?? draft.baseURL,
        },
      ]
    }),
  )
}

function mergeProviderDrafts(
  defaults: Record<string, ProviderDraftState>,
  current: Record<string, ProviderDraftState>,
) {
  return Object.fromEntries(
    Object.entries(defaults).map(([providerID, draft]) => {
      const currentDraft = current[providerID]
      if (!currentDraft) return [providerID, draft]

      return [
        providerID,
        {
          ...draft,
          apiKey: currentDraft.apiKey,
          baseURL: currentDraft.baseURL,
          selectedAuthMethod: currentDraft.selectedAuthMethod ?? draft.selectedAuthMethod,
          activeFlow: draft.activeFlow ?? currentDraft.activeFlow ?? null,
        },
      ]
    }),
  )
}

function resolveProviderAuthFlowMethod(provider: ProviderCatalogItem, draft?: ProviderDraftState) {
  if (
    provider.id === ANYBOX_ACCOUNT_PROVIDER_ID &&
    provider.authCapabilities.some(
      (capability) => capability.method === ANYBOX_BROWSER_AUTH_METHOD && capability.kind === "browser_oauth",
    )
  ) {
    return ANYBOX_BROWSER_AUTH_METHOD
  }

  return draft?.selectedAuthMethod ?? provider.authState.activeMethod ?? provider.authCapabilities[0]?.method
}

function getProviderAuthFailureMessage(providerID: string, flow: ProviderAuthFlow) {
  if (flow.errorMessage) return flow.errorMessage
  if (providerID === ANYBOX_ACCOUNT_PROVIDER_ID) {
    return "The desktop app could not connect to the Anybox API. Use Test connection for network diagnostics, or switch proxy rules and try again."
  }
  return "Provider authentication failed."
}

function normalizeProviderCatalogItem(item: ProviderCatalogItem): ProviderCatalogItem {
  const partial = item as Partial<ProviderCatalogItem>
  const authCapabilities: ProviderAuthCapability[] =
    Array.isArray(partial.authCapabilities) && partial.authCapabilities.length > 0
      ? partial.authCapabilities
      : [
          {
            method: "api-key",
            label: "API key",
            kind: "api_key",
            supportsDisconnect: true,
          },
        ]
  const fallbackMethod = partial.activeAuthMethod ?? authCapabilities[0]?.method ?? undefined
  const authStatePartial = partial.authState as Partial<ProviderCatalogItem["authState"]> | undefined
  const status =
    authStatePartial?.status ??
    (partial.available ? "connected" : partial.lastAuthError ? "error" : "not_connected")
  const connectionLabel =
    partial.connectionLabel ??
    authStatePartial?.connectionLabel ??
    (status === "connected"
      ? "Connected"
      : status === "pending"
        ? "Pending"
        : status === "expired"
          ? "Expired"
          : status === "error"
            ? "Error"
            : partial.apiKeyConfigured
              ? "Configured"
              : "Not connected")

  return {
    ...item,
    isCustomProvider: partial.isCustomProvider ?? (partial.source === "custom" || partial.id?.startsWith("custom-") === true),
    authCapabilities,
    authState: {
      providerID: partial.id ?? item.id,
      scope: "global",
      activeMethod: authStatePartial?.activeMethod ?? fallbackMethod,
      status,
      connectionLabel,
      lastError: partial.lastAuthError ?? authStatePartial?.lastError,
      expiresAt: authStatePartial?.expiresAt,
      account: authStatePartial?.account,
      capabilities: authStatePartial?.capabilities ?? authCapabilities,
      credentials: authStatePartial?.credentials ?? [],
      flow: authStatePartial?.flow,
    },
    authScope: "global",
    activeAuthMethod: partial.activeAuthMethod ?? authStatePartial?.activeMethod ?? fallbackMethod,
    connectionLabel,
    lastAuthError: partial.lastAuthError ?? authStatePartial?.lastError,
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function tryParseStringArrayLiteral(input: string) {
  const trimmed = input.trim()
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null

  try {
    const parsed = JSON.parse(trimmed)
    if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string")) {
      return null
    }

    return parsed
      .map((value) => value.trim())
      .filter(Boolean)
  } catch {
    return null
  }
}

function parseLineList(input: string) {
  const parsedLiteral = tryParseStringArrayLiteral(input)
  if (parsedLiteral) return parsedLiteral

  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function stringifyLineList(entries?: string[]) {
  return (entries ?? [])
    .flatMap((entry) => tryParseStringArrayLiteral(entry) ?? [entry])
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join("\n")
}

function stringifyKeyValueEntries(entries?: Record<string, string>) {
  return Object.entries(entries ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")
}

function stringifyAllowedToolNames(allowedTools?: McpAllowedTools) {
  if (Array.isArray(allowedTools)) {
    return stringifyLineList(allowedTools)
  }

  return stringifyLineList(allowedTools?.toolNames)
}

function resolveAllowedToolsMode(allowedTools?: McpAllowedTools): McpServerDraftState["allowedToolsMode"] {
  if (!allowedTools) return "all"
  if (Array.isArray(allowedTools)) return "names"
  if (allowedTools.readOnly && (allowedTools.toolNames?.length ?? 0) > 0) return "read-only-names"
  if (allowedTools.readOnly) return "read-only"
  if ((allowedTools.toolNames?.length ?? 0) > 0) return "names"
  return "all"
}

function normalizeToolPolicyDraft(policies?: McpToolPolicies): Record<string, McpToolPolicyValue> {
  return Object.fromEntries(
    Object.entries(policies ?? {})
      .filter(([toolName, policy]) => toolName.trim() && policy?.policy)
      .map(([toolName, policy]) => [toolName, policy.policy]),
  )
}

function toMcpDraft(server?: McpServerSummary): McpServerDraftState {
  return {
    id: server?.id ?? "",
    name: server?.name ?? "",
    transport: server?.transport ?? "stdio",
    command: server?.transport === "stdio" ? server.command : "",
    args: server?.transport === "stdio" ? stringifyLineList(server.args) : "",
    env: server?.transport === "stdio" ? stringifyKeyValueEntries(server.env) : "",
    cwd: server?.transport === "stdio" ? (server.cwd ?? "") : "",
    serverUrl: server?.transport === "remote" ? (server.serverUrl ?? "") : "",
    connectorId: server?.transport === "connector" ? server.connectorId : "",
    authorization: server?.transport === "remote" ? (server.authorization ?? "") : "",
    headers: server?.transport === "remote" ? stringifyKeyValueEntries(server.headers) : "",
    allowedToolsMode: server?.transport === "remote" || server?.transport === "connector" ? resolveAllowedToolsMode(server.allowedTools) : "all",
    allowedToolNames: server?.transport === "remote" || server?.transport === "connector" ? stringifyAllowedToolNames(server.allowedTools) : "",
    toolPolicies: normalizeToolPolicyDraft(server?.toolPolicies),
    enabled: server?.enabled ?? true,
    timeoutMs: typeof server?.timeoutMs === "number" ? String(server.timeoutMs) : "",
  }
}

function buildPluginDraft(plugin: PluginCatalogItem | undefined, installed?: InstalledPlugin | null): PluginDraftState {
  if (!plugin) {
    return {
      pluginID: null,
      config: {},
      appApiKeys: {},
    }
  }

  return {
    pluginID: plugin.id,
    config: Object.fromEntries(
      plugin.configFields.map((field) => [
        field.key,
        installed?.config[field.key] ?? field.defaultValue ?? "",
      ]),
    ),
    appApiKeys: Object.fromEntries((plugin.apps ?? []).map((app) => [app.appID, ""])),
  }
}

function fallbackConnectorID(definitionID: string) {
  return `connector:${definitionID}:default`
}

function connectorIDForDefinition(definition: ConnectorDefinition, statuses: ConnectorStatus[]) {
  return statuses.find((status) => status.definitionID === definition.id)?.connectorID ?? fallbackConnectorID(definition.id)
}

function normalizeConnectorDefinition(definition: ConnectorDefinition): ConnectorDefinition {
  return {
    ...definition,
    configFields: definition.configFields ?? [],
  }
}

function buildConnectorApiKeyDrafts(
  catalog: ConnectorDefinition[],
  statuses: ConnectorStatus[],
  current: Record<string, string>,
) {
  const connectorIDs = new Set([
    ...catalog.map((definition) => connectorIDForDefinition(definition, statuses)),
    ...statuses.map((status) => status.connectorID),
  ])

  return Object.fromEntries([...connectorIDs].map((connectorID) => [connectorID, current[connectorID] ?? ""]))
}

function buildConnectorConfigDrafts(
  catalog: ConnectorDefinition[],
  statuses: ConnectorStatus[],
  current: Record<string, Record<string, string>>,
) {
  return Object.fromEntries(
    catalog.map((definition) => {
      const connectorID = connectorIDForDefinition(definition, statuses)
      const currentDraft = current[connectorID] ?? {}
      return [
        connectorID,
        Object.fromEntries(definition.configFields.map((field) => [field.key, currentDraft[field.key] ?? field.defaultValue ?? ""])),
      ]
    }),
  )
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function formatMcpDiagnosticMessage(diagnostic: McpServerDiagnostic, context: "save" | "diagnose" = "save"): SettingsMessage {
  if (diagnostic.ok) {
    return {
      tone: "success",
      text:
        diagnostic.toolCount > 0
          ? `MCP server reachable. Listed ${diagnostic.toolCount} tool${diagnostic.toolCount === 1 ? "" : "s"}.`
          : "MCP server reachable, but it did not expose any tools.",
    }
  }

  const failurePrefix = context === "diagnose"
    ? "Tool discovery failed"
    : "MCP server saved, but tool discovery failed"

  return {
    tone: "error",
    text: diagnostic.error
      ? `${failurePrefix}: ${diagnostic.error}`
      : `${failurePrefix}.`,
  }
}

function parseMcpKeyValue(input: string, label: string) {
  const entries = parseLineList(input).map((line) => {
    const separatorIndex = line.indexOf("=")
    if (separatorIndex === -1) {
      throw new Error(`Invalid ${label} line '${line}'. Use KEY=value format.`)
    }

    const key = line.slice(0, separatorIndex).trim()
    const value = line.slice(separatorIndex + 1)
    if (!key) {
      throw new Error(`Invalid ${label} line '${line}'. Keys cannot be empty.`)
    }

    return [key, value] as const
  })

  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function buildAllowedTools(draft: McpServerDraftState): McpAllowedTools | undefined {
  const toolNames = parseLineList(draft.allowedToolNames)

  switch (draft.allowedToolsMode) {
    case "all":
      return undefined
    case "names":
      return toolNames.length > 0 ? toolNames : undefined
    case "read-only":
      return { readOnly: true }
    case "read-only-names":
      return {
        readOnly: true,
        ...(toolNames.length > 0 ? { toolNames } : {}),
      }
  }
}

function buildToolPolicies(draft: McpServerDraftState): McpToolPolicies | undefined {
  const entries = Object.entries(draft.toolPolicies)
    .filter(([toolName]) => toolName.trim())
    .map(([toolName, policy]) => [toolName, { policy }] as const)

  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function getMcpServerValidationError(draft: McpServerDraftState) {
  const serverID = draft.id.trim()
  if (!serverID) {
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
    parseLineList(draft.allowedToolNames).length === 0
  ) {
    return "Named tool filters require at least one tool name."
  }

  return null
}

export function useSettingsPage(options: UseSettingsPageOptions) {
  const toast = useToast()
  const { t } = useI18n()
  const isBuiltinToolsPageOpen = options.isBuiltinToolsPageOpen ?? false
  const isConnectorsPageOpen = options.isConnectorsPageOpen ?? false
  const isMcpServersPageOpen = options.isMcpServersPageOpen ?? false
  const isPluginsPageOpen = options.isPluginsPageOpen ?? false
  const isPromptPresetEditorOpen = options.isPromptPresetEditorOpen ?? false
  const [isOpen, setIsOpen] = useState(false)
  const [catalog, setCatalog] = useState<ProviderCatalogItem[]>([])
  const [cinemaVideoProviders, setCinemaVideoProviders] = useState<CinemaVideoProvider[]>([])
  const [models, setModels] = useState<ProviderModel[]>([])
  const [modelCatalog, setModelCatalog] = useState<ModelCatalogItem[]>([])
  const [savedSelection, setSavedSelection] = useState<ProjectModelSelection>(EMPTY_PROJECT_MODEL_SELECTION)
  const [selectionDraft, setSelectionDraft] = useState<ProjectModelSelection>(EMPTY_PROJECT_MODEL_SELECTION)
  const [providerDrafts, setProviderDrafts] = useState<Record<string, ProviderDraftState>>({})
  const [cinemaVideoProviderDrafts, setCinemaVideoProviderDrafts] = useState<Record<string, CinemaVideoProviderDraftState>>({})
  const [customProviderDraft, setCustomProviderDraft] =
    useState<CustomProviderDraftState>(defaultCustomProviderDraft)
  const [mcpServers, setMcpServers] = useState<McpServerSummary[]>([])
  const [mcpDiagnostics, setMcpDiagnostics] = useState<Record<string, McpServerDiagnostic>>({})
  const [activeMcpServerID, setActiveMcpServerID] = useState<string | null>(null)
  const [mcpServerDraft, setMcpServerDraft] = useState<McpServerDraftState>(() => toMcpDraft())
  const [pluginCatalog, setPluginCatalog] = useState<PluginCatalogItem[]>([])
  const [installedPlugins, setInstalledPlugins] = useState<InstalledPlugin[]>([])
  const [pluginDiagnostics, setPluginDiagnostics] = useState<Record<string, McpServerDiagnostic>>({})
  const [pluginConnectorStatuses, setPluginConnectorStatuses] = useState<Record<string, PluginConnectorStatus[]>>({})
  const [connectorCatalog, setConnectorCatalog] = useState<ConnectorDefinition[]>([])
  const [connectorStatuses, setConnectorStatuses] = useState<ConnectorStatus[]>([])
  const [connectorApiKeyDrafts, setConnectorApiKeyDrafts] = useState<Record<string, string>>({})
  const [connectorConfigDrafts, setConnectorConfigDrafts] = useState<Record<string, Record<string, string>>>({})
  const [activeConnectorID, setActiveConnectorID] = useState<string | null>(null)
  const activeConnectorIDRef = useRef<string | null>(null)
  const [activePluginID, setActivePluginID] = useState<string | null>(null)
  const activePluginIDRef = useRef<string | null>(null)
  const [pluginDraft, setPluginDraft] = useState<PluginDraftState>(() => buildPluginDraft(undefined))
  const [builtinTools, setBuiltinTools] = useState<BuiltinToolSummary[]>([])
  const [builtinToolSelection, setBuiltinToolSelection] = useState<BuiltinToolSelection>(EMPTY_BUILTIN_TOOL_SELECTION)
  const [savedBuiltinToolSelection, setSavedBuiltinToolSelection] =
    useState<BuiltinToolSelection>(EMPTY_BUILTIN_TOOL_SELECTION)
  const [promptPresets, setPromptPresets] = useState<PromptPresetSummary[]>([])
  const [promptPresetSelection, setPromptPresetSelection] = useState<PromptPresetSelection | null>(null)
  const [savedPromptPresetSelection, setSavedPromptPresetSelection] = useState<PromptPresetSelection | null>(null)
  const [selectedPromptPresetID, setSelectedPromptPresetID] = useState<string | null>(null)
  const [selectedPromptPreset, setSelectedPromptPreset] = useState<PromptPresetDocument | null>(null)
  const [promptDraftLabel, setPromptDraftLabel] = useState("")
  const [savedPromptLabel, setSavedPromptLabel] = useState("")
  const [promptDraftContent, setPromptDraftContent] = useState("")
  const [savedPromptContent, setSavedPromptContent] = useState("")
  const [promptRoot, setPromptRoot] = useState("")
  const [isPromptUrlInstallDialogOpen, setIsPromptUrlInstallDialogOpen] = useState(false)
  const [promptUrlInstallSource, setPromptUrlInstallSource] = useState("")
  const [promptUrlInstallPreview, setPromptUrlInstallPreview] = useState<PromptUrlInstallPreview | null>(null)
  const [selectedPromptUrlInstallIDs, setSelectedPromptUrlInstallIDs] = useState<string[]>([])
  const [promptUrlInstallMessage, setPromptUrlInstallMessage] = useState<SettingsMessage | null>(null)
  const [archivedSessions, setArchivedSessions] = useState<ArchivedSessionSummary[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingBuiltinTools, setIsLoadingBuiltinTools] = useState(false)
  const [isLoadingPrompts, setIsLoadingPrompts] = useState(false)
  const [isLoadingPromptPreset, setIsLoadingPromptPreset] = useState(false)
  const [isLoadingArchivedSessions, setIsLoadingArchivedSessions] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [builtinToolsError, setBuiltinToolsError] = useState<string | null>(null)
  const [promptLoadError, setPromptLoadError] = useState<string | null>(null)
  const [archivedSessionsError, setArchivedSessionsError] = useState<string | null>(null)
  const [savingProviderID, setSavingProviderID] = useState<string | null>(null)
  const [savingCinemaVideoProviderID, setSavingCinemaVideoProviderID] = useState<string | null>(null)
  const [deletingProviderID, setDeletingProviderID] = useState<string | null>(null)
  const [testingProviderID, setTestingProviderID] = useState<string | null>(null)
  const [isRefreshingProviderCatalog, setIsRefreshingProviderCatalog] = useState(false)
  const [isRefreshingCinemaVideoProviderCatalog, setIsRefreshingCinemaVideoProviderCatalog] = useState(false)
  const [isSavingSelection, setIsSavingSelection] = useState(false)
  const [savingMcpServerID, setSavingMcpServerID] = useState<string | null>(null)
  const [deletingMcpServerID, setDeletingMcpServerID] = useState<string | null>(null)
  const [isImportingMcpConfigJson, setIsImportingMcpConfigJson] = useState(false)
  const [isLoadingConnectors, setIsLoadingConnectors] = useState(false)
  const [connectorsError, setConnectorsError] = useState<string | null>(null)
  const [isLoadingPlugins, setIsLoadingPlugins] = useState(false)
  const [pluginsError, setPluginsError] = useState<string | null>(null)
  const [installingPluginID, setInstallingPluginID] = useState<string | null>(null)
  const [updatingPluginID, setUpdatingPluginID] = useState<string | null>(null)
  const [deletingPluginID, setDeletingPluginID] = useState<string | null>(null)
  const [diagnosingPluginID, setDiagnosingPluginID] = useState<string | null>(null)
  const [savingConnectorID, setSavingConnectorID] = useState<string | null>(null)
  const [diagnosingConnectorID, setDiagnosingConnectorID] = useState<string | null>(null)
  const [savingPluginConnectorID, setSavingPluginConnectorID] = useState<string | null>(null)
  const [diagnosingPluginConnectorID, setDiagnosingPluginConnectorID] = useState<string | null>(null)
  const [isSavingBuiltinTools, setIsSavingBuiltinTools] = useState(false)
  const [isCreatingPromptPreset, setIsCreatingPromptPreset] = useState(false)
  const [isSavingPromptPresetSelection, setIsSavingPromptPresetSelection] = useState(false)
  const [savingPromptPresetSelectionField, setSavingPromptPresetSelectionField] =
    useState<keyof PromptPresetSelection | null>(null)
  const [deletingPromptPresetID, setDeletingPromptPresetID] = useState<string | null>(null)
  const [savingPromptPresetID, setSavingPromptPresetID] = useState<string | null>(null)
  const [resettingPromptPresetID, setResettingPromptPresetID] = useState<string | null>(null)
  const [isPreviewingPromptUrlInstall, setIsPreviewingPromptUrlInstall] = useState(false)
  const [isInstallingPromptUrlPrompts, setIsInstallingPromptUrlPrompts] = useState(false)
  const [isTranslatingPromptPreset, setIsTranslatingPromptPreset] = useState(false)
  const [restoringArchivedSessionID, setRestoringArchivedSessionID] = useState<string | null>(null)
  const [deletingArchivedSessionID, setDeletingArchivedSessionID] = useState<string | null>(null)
  const [isDeletingAllArchivedSessions, setIsDeletingAllArchivedSessions] = useState(false)
  const requestIDRef = useRef(0)
  const savedSelectionRef = useRef<ProjectModelSelection>(EMPTY_PROJECT_MODEL_SELECTION)
  const selectionDraftRef = useRef<ProjectModelSelection>(EMPTY_PROJECT_MODEL_SELECTION)
  const pendingSelectionSaveRef = useRef<ProjectModelSelection | null>(null)
  const isPersistingSelectionRef = useRef(false)
  const builtinToolsRequestIDRef = useRef(0)
  const archivedSessionsRequestIDRef = useRef(0)
  const mcpServersRequestIDRef = useRef(0)
  const mcpDiagnosticRequestIDRef = useRef<Record<string, number>>({})
  const connectorsRequestIDRef = useRef(0)
  const connectorStatusRequestIDRef = useRef<Record<string, number>>({})
  const pluginsRequestIDRef = useRef(0)
  const pluginDiagnosticRequestIDRef = useRef<Record<string, number>>({})
  const pluginConnectorsRequestIDRef = useRef<Record<string, number>>({})
  const promptPresetsRequestIDRef = useRef(0)
  const promptPresetDocumentRequestIDRef = useRef(0)

  const showMessage = useCallback((nextMessage: SettingsMessage) => {
    if (nextMessage.tone === "success") {
      toast.success(nextMessage.text)
    } else {
      toast.error(nextMessage.text)
    }
  }, [toast])

  useEffect(() => {
    if (!isOpen) return

    void loadSettingsData()
  }, [isOpen])

  useEffect(() => {
    if (!isBuiltinToolsPageOpen) return

    void loadBuiltinTools()
  }, [isBuiltinToolsPageOpen])

  useEffect(() => {
    if (!isMcpServersPageOpen) return

    void loadMcpServers()
  }, [isMcpServersPageOpen])

  useEffect(() => {
    if (!isPluginsPageOpen) return

    void loadPlugins()
  }, [isPluginsPageOpen])

  useEffect(() => {
    if (!isConnectorsPageOpen && !isPluginsPageOpen) return

    void loadConnectors({ silent: !isConnectorsPageOpen })
  }, [isConnectorsPageOpen, isPluginsPageOpen])

  useEffect(() => {
    if (!isPromptPresetEditorOpen) return

    void loadPromptPresets()
    void loadPromptTranslationModels()
  }, [isPromptPresetEditorOpen])

  async function notifyMcpUpdated() {
    try {
      await options.onMcpUpdated?.()
    } catch (error) {
      console.error("[desktop] global MCP sync failed:", error)
    }
  }

  async function notifySkillsUpdated() {
    try {
      await options.onSkillsUpdated?.()
    } catch (error) {
      console.error("[desktop] composer skills sync failed:", error)
    }
  }

  async function notifyPluginCapabilitiesUpdated() {
    await Promise.all([notifyMcpUpdated(), notifySkillsUpdated()])
  }

  async function notifyProviderModelsUpdated() {
    try {
      await options.onProviderModelsUpdated?.()
    } catch (error) {
      console.error("[desktop] composer model sync failed:", error)
    }
  }

  async function notifyArchivedSessionRestored(session: LoadedSessionSnapshot) {
    try {
      await options.onArchivedSessionRestored?.(session)
    } catch (error) {
      console.error("[desktop] archived session restore sync failed:", error)
    }
  }

  function syncPromptPresetSummary(document: PromptPresetDocument) {
    setPromptPresets((current) => {
      const nextSummary: PromptPresetSummary = {
        id: document.id,
        label: document.label,
        description: document.description,
        source: document.source,
        hasOverride: document.hasOverride,
        editable: document.editable,
        sourcePath: document.sourcePath,
        filePath: document.filePath,
        root: document.root,
      }

      if (current.some((preset) => preset.id === document.id)) {
        return current.map((preset) => (preset.id === document.id ? nextSummary : preset))
      }

      return [...current, nextSummary]
    })
  }

  async function loadPromptPresetDocument(presetID: string, optionsArg?: LoadSettingsOptions) {
    const readPromptPreset = window.desktop?.readPromptPreset
    if (!readPromptPreset) {
      setSelectedPromptPresetID(null)
      setSelectedPromptPreset(null)
      setPromptDraftLabel("")
      setSavedPromptLabel("")
      setPromptDraftContent("")
      setSavedPromptContent("")
      setPromptLoadError(t("prompts.message.apiUnavailable"))
      return null
    }

    const requestID = ++promptPresetDocumentRequestIDRef.current
    if (!optionsArg?.silent) {
      setIsLoadingPromptPreset(true)
    }
    setPromptLoadError(null)

    try {
      const document = await readPromptPreset({ presetID })
      if (promptPresetDocumentRequestIDRef.current !== requestID) return null
      setSelectedPromptPresetID(document.id)
      setSelectedPromptPreset(document)
      setPromptDraftLabel(document.label)
      setSavedPromptLabel(document.label)
      setPromptDraftContent(document.content)
      setSavedPromptContent(document.content)
      setPromptRoot(document.root ?? "")
      syncPromptPresetSummary(document)
      return document
    } catch (error) {
      if (promptPresetDocumentRequestIDRef.current !== requestID) return null
      setPromptLoadError(getErrorMessage(error))
      return null
    } finally {
      if (promptPresetDocumentRequestIDRef.current === requestID) {
        setIsLoadingPromptPreset(false)
      }
    }
  }

  async function loadPromptPresets(optionsArg?: LoadSettingsOptions) {
    const getPromptPresets = window.desktop?.getPromptPresets
    const getPromptPresetSelection = window.desktop?.getPromptPresetSelection
    if (!getPromptPresets || !getPromptPresetSelection) {
      setPromptPresets([])
      setPromptPresetSelection(null)
      setSavedPromptPresetSelection(null)
      setSelectedPromptPresetID(null)
      setSelectedPromptPreset(null)
      setPromptDraftLabel("")
      setSavedPromptLabel("")
      setPromptDraftContent("")
      setSavedPromptContent("")
      setPromptRoot("")
      setPromptLoadError(t("prompts.message.apiUnavailable"))
      return
    }

    const requestID = ++promptPresetsRequestIDRef.current
    if (!optionsArg?.silent) {
      setIsLoadingPrompts(true)
    }
    setPromptLoadError(null)

    try {
      const [nextPromptPresets, nextPromptPresetSelection] = await Promise.all([
        getPromptPresets(),
        getPromptPresetSelection(),
      ])
      if (promptPresetsRequestIDRef.current !== requestID) return

      setPromptPresets(nextPromptPresets)
      setPromptRoot(nextPromptPresets.find((preset) => preset.root)?.root ?? "")
      setPromptPresetSelection(nextPromptPresetSelection)
      setSavedPromptPresetSelection(nextPromptPresetSelection)
      const preferredPresetID =
        (selectedPromptPresetID && nextPromptPresets.some((preset) => preset.id === selectedPromptPresetID)
          ? selectedPromptPresetID
          : nextPromptPresets.find((preset) => preset.id === nextPromptPresetSelection.systemPromptPresetID)?.id ??
            nextPromptPresets[0]?.id) ?? null

      if (!preferredPresetID) {
        setSelectedPromptPresetID(null)
        setSelectedPromptPreset(null)
        setPromptDraftLabel("")
        setSavedPromptLabel("")
        setPromptDraftContent("")
        setSavedPromptContent("")
        setPromptRoot("")
        return
      }

      await loadPromptPresetDocument(preferredPresetID, { silent: true })
    } catch (error) {
      if (promptPresetsRequestIDRef.current !== requestID) return
      setPromptPresets([])
      setPromptPresetSelection(null)
      setSavedPromptPresetSelection(null)
      setSelectedPromptPresetID(null)
      setSelectedPromptPreset(null)
      setPromptDraftLabel("")
      setSavedPromptLabel("")
      setPromptDraftContent("")
      setSavedPromptContent("")
      setPromptRoot("")
      setPromptLoadError(getErrorMessage(error))
    } finally {
      if (promptPresetsRequestIDRef.current === requestID) {
        setIsLoadingPrompts(false)
      }
    }
  }

  useEffect(() => {
    if ((!isOpen && !isMcpServersPageOpen) || !activeMcpServerID) return

    void loadMcpServerDiagnostic(activeMcpServerID)
  }, [activeMcpServerID, isMcpServersPageOpen, isOpen])

  const loadArchivedSessions = useCallback(async (optionsArg?: LoadSettingsOptions) => {
    const listArchivedSessions = window.desktop?.listArchivedSessions
    if (!listArchivedSessions) {
      setArchivedSessions([])
      setArchivedSessionsError("Desktop archived session APIs are unavailable.")
      return
    }

    const requestID = ++archivedSessionsRequestIDRef.current
    if (!optionsArg?.silent) {
      setIsLoadingArchivedSessions(true)
    }
    setArchivedSessionsError(null)

    try {
      const nextArchivedSessions = await listArchivedSessions()
      if (archivedSessionsRequestIDRef.current !== requestID) return
      setArchivedSessions(nextArchivedSessions)
    } catch (error) {
      if (archivedSessionsRequestIDRef.current !== requestID) return
      setArchivedSessions([])
      setArchivedSessionsError(getErrorMessage(error))
    } finally {
      if (archivedSessionsRequestIDRef.current === requestID) {
        setIsLoadingArchivedSessions(false)
      }
    }
  }, [])

  async function loadSettingsData(optionsArg?: LoadSettingsOptions) {
    const loadProviderCatalog = window.desktop?.getGlobalProviderCatalog
    const loadCinemaVideoProviders = window.desktop?.getCinemaVideoProviders
    const loadModels = window.desktop?.getGlobalModels
    const loadModelCatalog = window.desktop?.getGlobalModelCatalog

    if (!loadProviderCatalog || !loadModels) {
      setLoadError("Desktop provider settings APIs are unavailable.")
      setCatalog([])
      setCinemaVideoProviders([])
      setModels([])
      setModelCatalog([])
      setProviderDrafts({})
      setCinemaVideoProviderDrafts({})
      return
    }

    const requestID = ++requestIDRef.current
    if (!optionsArg?.silent) {
      setIsLoading(true)
    }
    setLoadError(null)

    try {
      const [nextCatalog, modelPayload, nextCinemaVideoProviders, nextModelCatalog] = await Promise.all([
        loadProviderCatalog(),
        loadModels(),
        loadCinemaVideoProviders?.() ?? Promise.resolve([]),
        loadModelCatalog?.() ?? Promise.resolve({ items: [] }),
      ])
      const normalizedCatalog = nextCatalog.map((item) => normalizeProviderCatalogItem(item))

      if (requestIDRef.current !== requestID) return

      const nextSelection = normalizeSelection(modelPayload.selection)
      setCatalog(normalizedCatalog)
      setCinemaVideoProviders(nextCinemaVideoProviders)
      setModels(modelPayload.items)
      setModelCatalog(nextModelCatalog.items)
      savedSelectionRef.current = nextSelection
      selectionDraftRef.current = nextSelection
      setSavedSelection(nextSelection)
      setSelectionDraft(nextSelection)
      const nextProviderDrafts = buildProviderDrafts(normalizedCatalog)
      const nextCinemaVideoProviderDrafts = buildCinemaVideoProviderDrafts(nextCinemaVideoProviders)
      if (optionsArg?.preserveProviderDrafts) {
        setProviderDrafts((current) => mergeProviderDrafts(nextProviderDrafts, current))
        setCinemaVideoProviderDrafts((current) => mergeCinemaVideoProviderDrafts(nextCinemaVideoProviderDrafts, current))
      } else {
        setProviderDrafts(nextProviderDrafts)
        setCinemaVideoProviderDrafts(nextCinemaVideoProviderDrafts)
      }
    } catch (error) {
      if (requestIDRef.current !== requestID) return
      setCatalog([])
      setCinemaVideoProviders([])
      setModels([])
      setModelCatalog([])
      setProviderDrafts({})
      setCinemaVideoProviderDrafts({})
      setLoadError(getErrorMessage(error))
    } finally {
      if (requestIDRef.current === requestID) {
        setIsLoading(false)
      }
    }
  }

  async function loadPromptTranslationModels() {
    const loadModels = window.desktop?.getGlobalModels
    if (!loadModels) return

    try {
      const modelPayload = await loadModels()
      setModels(modelPayload.items)
      const modelCatalogPayload = await window.desktop?.getGlobalModelCatalog?.()
      if (modelCatalogPayload) setModelCatalog(modelCatalogPayload.items)
    } catch (error) {
      console.error("[desktop] load prompt translation models failed:", error)
    }
  }

  async function loadMcpServers(optionsArg?: LoadSettingsOptions) {
    const getGlobalMcpServers = window.desktop?.getGlobalMcpServers
    if (!getGlobalMcpServers) {
      setLoadError("Desktop MCP settings APIs are unavailable.")
      setMcpServers([])
      setMcpDiagnostics({})
      setMcpServerDraft(toMcpDraft())
      setActiveMcpServerID(null)
      return
    }

    const requestID = ++mcpServersRequestIDRef.current
    if (!optionsArg?.silent) {
      setIsLoading(true)
    }
    setLoadError(null)

    try {
      const nextMcpServers = await getGlobalMcpServers()
      if (mcpServersRequestIDRef.current !== requestID) return

      setMcpServers(nextMcpServers)
      setMcpDiagnostics((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([serverID]) => nextMcpServers.some((server) => server.id === serverID)),
        ),
      )
      setActiveMcpServerID((current) => {
        if (!current) return current
        return nextMcpServers.some((server) => server.id === current) ? current : null
      })
      setMcpServerDraft((currentDraft) => {
        if (!currentDraft.id) return toMcpDraft()
        const updated = nextMcpServers.find((server) => server.id === currentDraft.id)
        return updated ? toMcpDraft(updated) : toMcpDraft()
      })
    } catch (error) {
      if (mcpServersRequestIDRef.current !== requestID) return
      setMcpServers([])
      setMcpDiagnostics({})
      setMcpServerDraft(toMcpDraft())
      setActiveMcpServerID(null)
      setLoadError(getErrorMessage(error))
    } finally {
      if (mcpServersRequestIDRef.current === requestID) {
        setIsLoading(false)
      }
    }
  }

  function setActiveConnectorSelection(connectorID: string | null) {
    activeConnectorIDRef.current = connectorID
    setActiveConnectorID(connectorID)
  }

  function upsertConnectorStatus(status: ConnectorStatus) {
    setConnectorStatuses((current) => {
      const existingIndex = current.findIndex((item) => item.connectorID === status.connectorID)
      if (existingIndex < 0) return [...current, status]

      const next = [...current]
      next[existingIndex] = status
      return next
    })
    setConnectorApiKeyDrafts((current) => ({
      ...current,
      [status.connectorID]: current[status.connectorID] ?? "",
    }))
    setConnectorConfigDrafts((current) => ({
      ...current,
      [status.connectorID]: current[status.connectorID] ?? {},
    }))
  }

  function applyConnectorSnapshot(
    nextCatalog: ConnectorDefinition[],
    nextStatuses: ConnectorStatus[],
  ) {
    const normalizedCatalog = nextCatalog.map(normalizeConnectorDefinition)

    setConnectorCatalog(normalizedCatalog)
    setConnectorStatuses(nextStatuses)
    setConnectorApiKeyDrafts((current) => buildConnectorApiKeyDrafts(normalizedCatalog, nextStatuses, current))
    setConnectorConfigDrafts((current) => buildConnectorConfigDrafts(normalizedCatalog, nextStatuses, current))

    const connectorIDs = new Set([
      ...normalizedCatalog.map((definition) => connectorIDForDefinition(definition, nextStatuses)),
      ...nextStatuses.map((status) => status.connectorID),
    ])
    const currentConnectorID = activeConnectorIDRef.current
    const preferredConnectorID =
      currentConnectorID && connectorIDs.has(currentConnectorID)
        ? currentConnectorID
        : normalizedCatalog[0]
          ? connectorIDForDefinition(normalizedCatalog[0], nextStatuses)
          : nextStatuses[0]?.connectorID ?? null

    setActiveConnectorSelection(preferredConnectorID)
  }

  async function loadConnectors(optionsArg?: LoadSettingsOptions) {
    const getConnectorCatalog = window.desktop?.getConnectorCatalog
    const getConnectors = window.desktop?.getConnectors
    if (!getConnectorCatalog || !getConnectors) {
      setConnectorCatalog([])
      setConnectorStatuses([])
      setConnectorApiKeyDrafts({})
      setConnectorConfigDrafts({})
      setActiveConnectorSelection(null)
      setConnectorsError("Desktop connector APIs are unavailable.")
      return
    }

    const requestID = ++connectorsRequestIDRef.current
    if (!optionsArg?.silent) {
      setIsLoadingConnectors(true)
    }
    setConnectorsError(null)

    try {
      const [nextCatalog, nextStatuses] = await Promise.all([
        getConnectorCatalog(),
        getConnectors(),
      ])
      if (connectorsRequestIDRef.current !== requestID) return

      applyConnectorSnapshot(nextCatalog, nextStatuses)
    } catch (error) {
      if (connectorsRequestIDRef.current !== requestID) return
      setConnectorCatalog([])
      setConnectorStatuses([])
      setConnectorApiKeyDrafts({})
      setConnectorConfigDrafts({})
      setActiveConnectorSelection(null)
      setConnectorsError(getErrorMessage(error))
    } finally {
      if (connectorsRequestIDRef.current === requestID) {
        setIsLoadingConnectors(false)
      }
    }
  }

  async function loadConnectorStatus(connectorID: string) {
    const getConnector = window.desktop?.getConnector
    if (!getConnector) return null

    const requestID = (connectorStatusRequestIDRef.current[connectorID] ?? 0) + 1
    connectorStatusRequestIDRef.current[connectorID] = requestID

    try {
      const status = await getConnector({ connectorID })
      if (connectorStatusRequestIDRef.current[connectorID] !== requestID) return null

      upsertConnectorStatus(status)
      return status
    } catch {
      if (connectorStatusRequestIDRef.current[connectorID] !== requestID) return null
      return null
    }
  }

  function selectConnector(connectorID: string) {
    setActiveConnectorSelection(connectorID)
  }

  function setConnectorApiKeyDraft(connectorID: string, value: string) {
    setConnectorApiKeyDrafts((current) => ({
      ...current,
      [connectorID]: value,
    }))
  }

  function setConnectorConfigDraft(connectorID: string, key: string, value: string) {
    setConnectorConfigDrafts((current) => ({
      ...current,
      [connectorID]: {
        ...(current[connectorID] ?? {}),
        [key]: value,
      },
    }))
  }

  async function saveConnectorApiKey(connectorID: string) {
    const saveConnectorApiKeyApi = window.desktop?.saveConnectorApiKey
    if (!saveConnectorApiKeyApi) return false

    const apiKey = connectorApiKeyDrafts[connectorID]?.trim() ?? ""
    setSavingConnectorID(connectorID)

    try {
      const status = await saveConnectorApiKeyApi({
        connectorID,
        apiKey: apiKey || null,
      })
      upsertConnectorStatus(status)
      await notifyMcpUpdated()
      setConnectorApiKeyDraft(connectorID, "")
      showMessage({
        tone: "success",
        text: apiKey ? "Connector API key saved." : "Connector API key cleared.",
      })
      return true
    } catch (error) {
      showMessage({
        tone: "error",
        text: getErrorMessage(error),
      })
      return false
    } finally {
      setSavingConnectorID(null)
    }
  }

  async function deleteConnectorApiKey(connectorID: string) {
    const deleteConnectorApiKeyApi = window.desktop?.deleteConnectorApiKey
    if (!deleteConnectorApiKeyApi) return false

    setSavingConnectorID(connectorID)

    try {
      const status = await deleteConnectorApiKeyApi({ connectorID })
      upsertConnectorStatus(status)
      await notifyMcpUpdated()
      showMessage({
        tone: "success",
        text: "Connector disconnected.",
      })
      return true
    } catch (error) {
      showMessage({
        tone: "error",
        text: getErrorMessage(error),
      })
      return false
    } finally {
      setSavingConnectorID(null)
    }
  }

  async function saveConnectorConfig(connectorID: string) {
    const saveConnectorConfigApi = window.desktop?.saveConnectorConfig
    if (!saveConnectorConfigApi) return false

    const config = connectorConfigDrafts[connectorID] ?? {}
    setSavingConnectorID(connectorID)

    try {
      const status = await saveConnectorConfigApi({
        connectorID,
        config,
      })
      upsertConnectorStatus(status)
      await notifyMcpUpdated()
      setConnectorConfigDrafts((current) => ({
        ...current,
        [connectorID]: {},
      }))
      showMessage({
        tone: "success",
        text: "Connector configuration saved. Continue with sign-in when the Feishu app callback URL and scopes are ready.",
      })
      return true
    } catch (error) {
      showMessage({
        tone: "error",
        text: getErrorMessage(error),
      })
      return false
    } finally {
      setSavingConnectorID(null)
    }
  }

  async function deleteConnectorConfig(connectorID: string) {
    const deleteConnectorConfigApi = window.desktop?.deleteConnectorConfig
    if (!deleteConnectorConfigApi) return false

    setSavingConnectorID(connectorID)

    try {
      const status = await deleteConnectorConfigApi({ connectorID })
      upsertConnectorStatus(status)
      await notifyMcpUpdated()
      showMessage({
        tone: "success",
        text: "Connector configuration cleared.",
      })
      return true
    } catch (error) {
      showMessage({
        tone: "error",
        text: getErrorMessage(error),
      })
      return false
    } finally {
      setSavingConnectorID(null)
    }
  }

  async function pollConnectorAuthFlow(connectorID: string, flowID: string) {
    const getConnectorAuthFlow = window.desktop?.getConnectorAuthFlow
    if (!getConnectorAuthFlow) return

    while (true) {
      try {
        const flow = await getConnectorAuthFlow({
          connectorID,
          flowID,
        })
        if (!flow) return

        await loadConnectorStatus(connectorID)

        if (["connected", "error", "expired", "cancelled"].includes(flow.status)) {
          await notifyMcpUpdated()
          if (flow.status === "connected") {
            showMessage({
              tone: "success",
              text: "Connector signed in.",
            })
          } else if (flow.status === "cancelled") {
            showMessage({
              tone: "error",
              text: flow.errorMessage ?? "Connector sign-in was cancelled.",
            })
          } else {
            showMessage({
              tone: "error",
              text: flow.errorMessage ?? "Connector sign-in failed.",
            })
          }
          return
        }
      } catch (error) {
        showMessage({
          tone: "error",
          text: getErrorMessage(error),
        })
        return
      }

      await sleep(1500)
    }
  }

  async function startConnectorAuthFlow(connectorID: string) {
    const startConnectorAuthFlowApi = window.desktop?.startConnectorAuthFlow
    if (!startConnectorAuthFlowApi) return false

    setSavingConnectorID(connectorID)

    try {
      const flow = await startConnectorAuthFlowApi({ connectorID })
      await loadConnectorStatus(connectorID)

      if (flow.authorizationURL && window.desktop?.openExternalUrl) {
        await window.desktop.openExternalUrl({ url: flow.authorizationURL })
      }

      showMessage({
        tone: "success",
        text: "Continue the connector sign-in flow in your browser.",
      })
      void pollConnectorAuthFlow(connectorID, flow.id)
      return true
    } catch (error) {
      showMessage({
        tone: "error",
        text: getErrorMessage(error),
      })
      return false
    } finally {
      setSavingConnectorID(null)
    }
  }

  async function cancelConnectorAuthFlow(connectorID: string) {
    const flowID = connectorStatuses.find((status) => status.connectorID === connectorID)?.activeFlow?.id
    const cancelConnectorAuthFlowApi = window.desktop?.cancelConnectorAuthFlow
    if (!flowID || !cancelConnectorAuthFlowApi) return false

    setSavingConnectorID(connectorID)

    try {
      await cancelConnectorAuthFlowApi({ connectorID, flowID })
      await loadConnectorStatus(connectorID)
      showMessage({
        tone: "success",
        text: "Connector sign-in cancelled.",
      })
      return true
    } catch (error) {
      showMessage({
        tone: "error",
        text: getErrorMessage(error),
      })
      return false
    } finally {
      setSavingConnectorID(null)
    }
  }

  async function deleteConnectorAuthSession(connectorID: string) {
    const deleteConnectorAuthSessionApi = window.desktop?.deleteConnectorAuthSession
    if (!deleteConnectorAuthSessionApi) return false

    setSavingConnectorID(connectorID)

    try {
      const status = await deleteConnectorAuthSessionApi({ connectorID })
      upsertConnectorStatus(status)
      await notifyMcpUpdated()
      showMessage({
        tone: "success",
        text: "Connector disconnected.",
      })
      return true
    } catch (error) {
      showMessage({
        tone: "error",
        text: getErrorMessage(error),
      })
      return false
    } finally {
      setSavingConnectorID(null)
    }
  }

  async function diagnoseConnector(connectorID: string) {
    const getConnectorDiagnostic = window.desktop?.getConnectorDiagnostic
    if (!getConnectorDiagnostic) return false

    setDiagnosingConnectorID(connectorID)

    try {
      const diagnostic = await getConnectorDiagnostic({ connectorID })
      await loadConnectorStatus(connectorID)
      showMessage(formatMcpDiagnosticMessage(diagnostic, "diagnose"))
      return diagnostic.ok
    } catch (error) {
      showMessage({
        tone: "error",
        text: getErrorMessage(error),
      })
      return false
    } finally {
      setDiagnosingConnectorID(null)
    }
  }

  function applyPluginSnapshot(
    nextCatalog: PluginCatalogItem[],
    nextInstalled: InstalledPlugin[],
    nextConnectorStatuses: Record<string, PluginConnectorStatus[]>,
  ) {
    const nextDisplayCatalog = mergePluginCatalogWithInstalled(nextCatalog, nextInstalled)

    setPluginCatalog(nextDisplayCatalog)
    setInstalledPlugins(nextInstalled)
    setPluginConnectorStatuses(nextConnectorStatuses)
    setPluginDiagnostics((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([pluginID]) =>
          nextInstalled.some((plugin) => plugin.pluginID === pluginID),
        ),
      ),
    )

    const currentActivePluginID = activePluginIDRef.current
    const preferredPluginID =
      currentActivePluginID && nextDisplayCatalog.some((plugin) => plugin.id === currentActivePluginID)
        ? currentActivePluginID
        : null
    setActivePluginSelection(preferredPluginID)
    const nextActivePlugin = nextDisplayCatalog.find((plugin) => plugin.id === preferredPluginID)
    const nextInstalledPlugin = nextInstalled.find((plugin) => plugin.pluginID === preferredPluginID) ?? null
    setPluginDraft(buildPluginDraft(nextActivePlugin, nextInstalledPlugin))
  }

  function setActivePluginSelection(pluginID: string | null) {
    activePluginIDRef.current = pluginID
    setActivePluginID(pluginID)
  }

  async function loadPlugins(optionsArg?: LoadSettingsOptions) {
    const getPluginCatalog = window.desktop?.getPluginCatalog
    const getInstalledPlugins = window.desktop?.getInstalledPlugins
    if (!getPluginCatalog || !getInstalledPlugins) {
      setPluginCatalog([])
      setInstalledPlugins([])
      setPluginDiagnostics({})
      setPluginConnectorStatuses({})
      setActivePluginSelection(null)
      setPluginDraft(buildPluginDraft(undefined))
      setPluginsError("Desktop plugin APIs are unavailable.")
      return
    }

    const requestID = ++pluginsRequestIDRef.current
    if (!optionsArg?.silent) {
      setIsLoadingPlugins(true)
    }
    setPluginsError(null)

    try {
      const [cachedCatalog, nextInstalled] = await Promise.all([
        getPluginCatalog({ freshness: "cached" }),
        getInstalledPlugins(),
      ])
      if (pluginsRequestIDRef.current !== requestID) return
      const nextConnectorStatuses = await loadPluginConnectorStatusesForInstalled(nextInstalled)
      if (pluginsRequestIDRef.current !== requestID) return

      applyPluginSnapshot(cachedCatalog, nextInstalled, nextConnectorStatuses)

      void getPluginCatalog({ freshness: "fresh" })
        .then((freshCatalog) => {
          if (pluginsRequestIDRef.current !== requestID) return
          if (arePluginCatalogsEqual(cachedCatalog, freshCatalog)) return
          applyPluginSnapshot(freshCatalog, nextInstalled, nextConnectorStatuses)
        })
        .catch((error) => {
          if (pluginsRequestIDRef.current !== requestID) return
          console.error("[desktop] background plugin catalog refresh failed:", error)
        })
    } catch (error) {
      if (pluginsRequestIDRef.current !== requestID) return
      setPluginCatalog([])
      setInstalledPlugins([])
      setPluginDiagnostics({})
      setPluginConnectorStatuses({})
      setActivePluginSelection(null)
      setPluginDraft(buildPluginDraft(undefined))
      setPluginsError(getErrorMessage(error))
    } finally {
      if (pluginsRequestIDRef.current === requestID) {
        setIsLoadingPlugins(false)
      }
    }
  }

  async function loadBuiltinTools(optionsArg?: LoadSettingsOptions) {
    const getBuiltinTools = window.desktop?.getBuiltinTools
    if (!getBuiltinTools) {
      setBuiltinTools([])
      setBuiltinToolSelection(normalizeBuiltinToolSelection())
      setSavedBuiltinToolSelection(normalizeBuiltinToolSelection())
      setBuiltinToolsError("Desktop built-in tool settings APIs are unavailable.")
      return
    }

    const requestID = ++builtinToolsRequestIDRef.current
    if (!optionsArg?.silent) {
      setIsLoadingBuiltinTools(true)
    }
    setBuiltinToolsError(null)

    try {
      const payload = await getBuiltinTools()
      if (builtinToolsRequestIDRef.current !== requestID) return

      const selection = normalizeBuiltinToolSelection(payload.selection)
      setBuiltinToolSelection(selection)
      setSavedBuiltinToolSelection(selection)
      setBuiltinTools(applyBuiltinToolSelection(payload.items, selection))
    } catch (error) {
      if (builtinToolsRequestIDRef.current !== requestID) return
      setBuiltinTools([])
      setBuiltinToolSelection(normalizeBuiltinToolSelection())
      setSavedBuiltinToolSelection(normalizeBuiltinToolSelection())
      setBuiltinToolsError(getErrorMessage(error))
    } finally {
      if (builtinToolsRequestIDRef.current === requestID) {
        setIsLoadingBuiltinTools(false)
      }
    }
  }

  async function loadMcpServerDiagnostic(serverID: string) {
    if (!window.desktop?.getGlobalMcpServerDiagnostic) return null

    const requestID = (mcpDiagnosticRequestIDRef.current[serverID] ?? 0) + 1
    mcpDiagnosticRequestIDRef.current[serverID] = requestID

    try {
      const diagnostic = await window.desktop.getGlobalMcpServerDiagnostic({
        serverID,
      })

      if (mcpDiagnosticRequestIDRef.current[serverID] !== requestID) return null

      setMcpDiagnostics((current) => ({
        ...current,
        [serverID]: diagnostic,
      }))
      setMcpServerDraft((current) => (
        current.id.trim() === serverID ? mergeMcpToolPolicyDefaults(current, diagnostic) : current
      ))

      return diagnostic
    } catch (error) {
      if (mcpDiagnosticRequestIDRef.current[serverID] !== requestID) return null

      const diagnostic: McpServerDiagnostic = {
        serverID,
        enabled: true,
        ok: false,
        toolCount: 0,
        toolNames: [],
        tools: [],
        error: getErrorMessage(error),
      }
      setMcpDiagnostics((current) => ({
        ...current,
        [serverID]: diagnostic,
      }))
      return diagnostic
    }
  }

  async function loadPluginDiagnostic(pluginID: string) {
    if (!window.desktop?.getInstalledPluginDiagnostic) return null

    const requestID = (pluginDiagnosticRequestIDRef.current[pluginID] ?? 0) + 1
    pluginDiagnosticRequestIDRef.current[pluginID] = requestID

    try {
      const diagnostic = await window.desktop.getInstalledPluginDiagnostic({
        pluginID,
      })

      if (pluginDiagnosticRequestIDRef.current[pluginID] !== requestID) return null

      setPluginDiagnostics((current) => ({
        ...current,
        [pluginID]: diagnostic,
      }))

      return diagnostic
    } catch (error) {
      if (pluginDiagnosticRequestIDRef.current[pluginID] !== requestID) return null

      const diagnostic: McpServerDiagnostic = {
        serverID: `plugin.${pluginID}`,
        enabled: true,
        ok: false,
        toolCount: 0,
        toolNames: [],
        tools: [],
        error: getErrorMessage(error),
      }
      setPluginDiagnostics((current) => ({
        ...current,
        [pluginID]: diagnostic,
      }))
      return diagnostic
    }
  }

  async function loadPluginConnectorStatusesForInstalled(items: InstalledPlugin[]) {
    const getInstalledPluginConnectors = window.desktop?.getInstalledPluginConnectors
    if (!getInstalledPluginConnectors) return {}

    const entries = await Promise.all(
      items.map(async (plugin) => {
        try {
          const statuses = await getInstalledPluginConnectors({
            pluginID: plugin.pluginID,
          })
          return [plugin.pluginID, statuses] as const
        } catch {
          return [plugin.pluginID, []] as const
        }
      }),
    )

    return Object.fromEntries(entries)
  }

  async function loadPluginConnectorStatuses(pluginID: string) {
    if (!window.desktop?.getInstalledPluginConnectors) return []

    const requestID = (pluginConnectorsRequestIDRef.current[pluginID] ?? 0) + 1
    pluginConnectorsRequestIDRef.current[pluginID] = requestID

    const statuses = await window.desktop.getInstalledPluginConnectors({ pluginID })
    if (pluginConnectorsRequestIDRef.current[pluginID] !== requestID) return []

    setPluginConnectorStatuses((current) => ({
      ...current,
      [pluginID]: statuses,
    }))
    return statuses
  }

  function openSettings() {
    setIsOpen(true)
  }

  function closeSettings() {
    setIsOpen(false)
  }

  function setProviderDraftValue(providerID: string, field: "apiKey" | "baseURL", value: string) {
    setProviderDrafts((current) => ({
      ...current,
      [providerID]: {
        apiKey: current[providerID]?.apiKey ?? "",
        baseURL: current[providerID]?.baseURL ?? "",
        selectedAuthMethod: current[providerID]?.selectedAuthMethod ?? null,
        activeFlow: current[providerID]?.activeFlow ?? null,
        [field]: value,
      },
    }))
  }

  function setCinemaVideoProviderDraftValue(providerID: string, field: "apiKey" | "baseURL", value: string) {
    setCinemaVideoProviderDrafts((current) => {
      const nextDraft = {
        apiKey: current[providerID]?.apiKey ?? "",
        baseURL: current[providerID]?.baseURL ?? "",
      }
      nextDraft[field] = value
      return {
        ...current,
        [providerID]: nextDraft,
      }
    })
  }

  function setCustomProviderDraftValue(field: keyof CustomProviderDraftState, value: string) {
    setCustomProviderDraft((current) => ({
      ...current,
      [field]: value,
    }))
  }

  function resetCustomProviderDraft(nextDraft: CustomProviderDraftState = defaultCustomProviderDraft) {
    setCustomProviderDraft(nextDraft)
  }

  function setProviderAuthMethod(providerID: string, method: string) {
    setProviderDrafts((current) => ({
      ...current,
      [providerID]: {
        apiKey: current[providerID]?.apiKey ?? "",
        baseURL: current[providerID]?.baseURL ?? "",
        selectedAuthMethod: method,
        activeFlow: current[providerID]?.activeFlow?.method === method ? current[providerID]?.activeFlow ?? null : null,
      },
    }))
  }

  function setSelectionDraftValue<K extends keyof ProjectModelSelection>(field: K, value: ProjectModelSelection[K]) {
    if (selectionDraftRef.current[field] === value) return

    const nextSelection = {
      ...selectionDraftRef.current,
      [field]: value,
    } as ProjectModelSelection

    selectionDraftRef.current = nextSelection
    setSelectionDraft(nextSelection)
    void saveSelection(nextSelection)
  }

  function startNewMcpServer() {
    setActiveMcpServerID(null)
    setMcpServerDraft(toMcpDraft())
  }

  function selectMcpServer(serverID: string) {
    const server = mcpServers.find((item) => item.id === serverID)
    if (!server) return

    setActiveMcpServerID(serverID)
    setMcpServerDraft(toMcpDraft(server))
  }

  function setMcpServerDraftValue(field: keyof McpServerDraftState, value: string | boolean) {
    setMcpServerDraft((current) => ({
      ...current,
      [field]: value,
    }))
  }

  function setMcpToolPolicy(toolName: string, policy: McpToolPolicyValue) {
    setMcpServerDraft((current) => ({
      ...current,
      toolPolicies: {
        ...current.toolPolicies,
        [toolName]: policy,
      },
    }))
  }

  function selectPlugin(pluginID: string) {
    const plugin = pluginCatalog.find((item) => item.id === pluginID)
    if (!plugin) return

    const installed = installedPlugins.find((item) => item.pluginID === pluginID) ?? null
    setActivePluginSelection(pluginID)
    setPluginDraft(buildPluginDraft(plugin, installed))
  }

  function clearPluginSelection() {
    setActivePluginSelection(null)
    setPluginDraft(buildPluginDraft(undefined))
  }

  function setPluginDraftConfigValue(key: string, value: string) {
    setPluginDraft((current) => ({
      ...current,
      config: {
        ...current.config,
        [key]: value,
      },
    }))
  }

  function setPluginDraftAppApiKey(appID: string, value: string) {
    setPluginDraft((current) => ({
      ...current,
      appApiKeys: {
        ...current.appApiKeys,
        [appID]: value,
      },
    }))
  }

  function setBuiltinToolEnabled(toolID: string, enabled: boolean) {
    setBuiltinToolSelection((current) => {
      return {
        tools: {
          ...current.tools,
          [toolID]: enabled,
        },
      }
    })
    setBuiltinTools((items) => items.map((tool) => (tool.id === toolID ? { ...tool, enabled } : tool)))
  }

  async function saveBuiltinTools() {
    const updateBuiltinToolSelection = window.desktop?.updateBuiltinToolSelection
    if (!updateBuiltinToolSelection) return false

    setIsSavingBuiltinTools(true)

    try {
      const selection = normalizeBuiltinToolSelection(
        await updateBuiltinToolSelection(builtinToolSelection),
      )
      setSavedBuiltinToolSelection(selection)
      setBuiltinToolSelection(selection)
      setBuiltinTools((items) => applyBuiltinToolSelection(items, selection))
      showMessage({
        tone: "success",
        text: "Built-in tool settings saved.",
      })
      return true
    } catch (error) {
      showMessage({
        tone: "error",
        text: getErrorMessage(error),
      })
      return false
    } finally {
      setIsSavingBuiltinTools(false)
    }
  }

  async function resetBuiltinTools() {
    const updateBuiltinToolSelection = window.desktop?.updateBuiltinToolSelection
    if (!updateBuiltinToolSelection) return false

    setIsSavingBuiltinTools(true)

    try {
      const selection = normalizeBuiltinToolSelection(await updateBuiltinToolSelection({ tools: {} }))
      setSavedBuiltinToolSelection(selection)
      setBuiltinToolSelection(selection)
      setBuiltinTools((items) => applyBuiltinToolSelection(items, selection))
      showMessage({
        tone: "success",
        text: "Built-in tool settings reset to defaults.",
      })
      return true
    } catch (error) {
      showMessage({
        tone: "error",
        text: getErrorMessage(error),
      })
      return false
    } finally {
      setIsSavingBuiltinTools(false)
    }
  }

  function setPromptDraftValue(value: string) {
    setPromptDraftContent(value)
  }

  function setPromptDraftLabelValue(value: string) {
    setPromptDraftLabel(value)
  }

  function buildPromptPresetSelectionValue(
    field: keyof PromptPresetSelection,
    value: string,
    current: PromptPresetSelection | null,
  ): PromptPresetSelection {
    if (current) {
      return {
        ...current,
        [field]: value,
      }
    }

    return {
      systemPromptPresetID: field === "systemPromptPresetID" ? value : selectedPromptPresetID ?? value,
      planModePromptPresetID: field === "planModePromptPresetID" ? value : selectedPromptPresetID ?? value,
      sideChatPromptPresetID: field === "sideChatPromptPresetID" ? value : selectedPromptPresetID ?? value,
      gitCommitPromptPresetID: field === "gitCommitPromptPresetID" ? value : selectedPromptPresetID ?? value,
    }
  }

  async function selectPromptPreset(presetID: string) {
    const document = await loadPromptPresetDocument(presetID)
    return Boolean(document)
  }

  async function persistPromptPresetSelection(
    selectionToSave: PromptPresetSelection,
    field?: keyof PromptPresetSelection,
    rollbackSelection?: PromptPresetSelection | null,
  ) {
    if (!window.desktop?.updatePromptPresetSelection) return false
    setIsSavingPromptPresetSelection(true)
    setSavingPromptPresetSelectionField(field ?? null)

    try {
      const selection = await window.desktop.updatePromptPresetSelection(selectionToSave)
      setPromptPresetSelection(selection)
      setSavedPromptPresetSelection(selection)
      showMessage({
        tone: "success",
        text:
          field === "systemPromptPresetID"
            ? t("prompts.message.systemUpdated")
            : field === "planModePromptPresetID"
              ? t("prompts.message.planUpdated")
              : field === "sideChatPromptPresetID"
                ? t("prompts.message.sideChatUpdated")
                : field === "gitCommitPromptPresetID"
                  ? t("prompts.message.gitCommitUpdated")
                  : t("prompts.message.assignmentsUpdated"),
      })
      return true
    } catch (error) {
      if (rollbackSelection) {
        setPromptPresetSelection(rollbackSelection)
      }
      showMessage({
        tone: "error",
        text: getErrorMessage(error),
      })
      return false
    } finally {
      setIsSavingPromptPresetSelection(false)
      setSavingPromptPresetSelectionField(null)
    }
  }

  async function setPromptPresetSelectionValue(
    field: keyof PromptPresetSelection,
    value: string,
  ) {
    const previousSelection = promptPresetSelection
    const nextSelection = buildPromptPresetSelectionValue(field, value, promptPresetSelection)
    setPromptPresetSelection(nextSelection)
    return persistPromptPresetSelection(nextSelection, field, previousSelection ?? savedPromptPresetSelection)
  }

  async function savePromptPresetSelection(field?: keyof PromptPresetSelection) {
    if (!promptPresetSelection) return false

    const selectionToSave =
      field && savedPromptPresetSelection
        ? {
            systemPromptPresetID:
              field === "systemPromptPresetID"
                ? promptPresetSelection.systemPromptPresetID
                : savedPromptPresetSelection.systemPromptPresetID,
            planModePromptPresetID:
              field === "planModePromptPresetID"
                ? promptPresetSelection.planModePromptPresetID
                : savedPromptPresetSelection.planModePromptPresetID,
            sideChatPromptPresetID:
              field === "sideChatPromptPresetID"
                ? promptPresetSelection.sideChatPromptPresetID
                : savedPromptPresetSelection.sideChatPromptPresetID,
            gitCommitPromptPresetID:
              field === "gitCommitPromptPresetID"
                ? promptPresetSelection.gitCommitPromptPresetID
                : savedPromptPresetSelection.gitCommitPromptPresetID,
          }
        : promptPresetSelection

    return persistPromptPresetSelection(selectionToSave, field)
  }

  async function createPromptPreset() {
    if (!window.desktop?.createPromptPreset) return false

    setIsCreatingPromptPreset(true)

    try {
      const document = await window.desktop.createPromptPreset({
        label: "Untitled preset",
        content: "",
      })
      setPromptPresets((current) => [...current, {
        id: document.id,
        label: document.label,
        description: document.description,
        source: document.source,
        hasOverride: document.hasOverride,
        editable: document.editable,
        sourcePath: document.sourcePath,
        filePath: document.filePath,
        root: document.root,
      }])
      setPromptRoot(document.root ?? "")
      setSelectedPromptPresetID(document.id)
      setSelectedPromptPreset(document)
      setPromptDraftLabel(document.label)
      setSavedPromptLabel(document.label)
      setPromptDraftContent(document.content)
      setSavedPromptContent(document.content)
      showMessage({
        tone: "success",
        text: t("prompts.message.created"),
      })
      return true
    } catch (error) {
      showMessage({
        tone: "error",
        text: getErrorMessage(error),
      })
      return false
    } finally {
      setIsCreatingPromptPreset(false)
    }
  }

  async function openPromptFolder() {
    const openPath = window.desktop?.openPath
    if (!promptRoot.trim()) return false


    if (!openPath) {
      showMessage({
        tone: "error",
        text: t("prompts.message.openFolderUnavailable"),
      })
      return false
    }

    try {
      await openPath({
        targetPath: promptRoot,
      })
      return true
    } catch (error) {
      showMessage({
        tone: "error",
        text: getErrorMessage(error),
      })
      return false
    }
  }

  function resetPromptUrlInstallDialog() {
    setPromptUrlInstallSource("")
    setPromptUrlInstallPreview(null)
    setSelectedPromptUrlInstallIDs([])
    setPromptUrlInstallMessage(null)
  }

  function openPromptUrlInstallDialog() {
    if (isPreviewingPromptUrlInstall || isInstallingPromptUrlPrompts) return
    resetPromptUrlInstallDialog()
    setIsPromptUrlInstallDialogOpen(true)
  }

  function closePromptUrlInstallDialog() {
    if (isPreviewingPromptUrlInstall || isInstallingPromptUrlPrompts) return
    setIsPromptUrlInstallDialogOpen(false)
    resetPromptUrlInstallDialog()
  }

  function setPromptUrlInstallSourceValue(value: string) {
    setPromptUrlInstallSource(value)
    setPromptUrlInstallPreview(null)
    setSelectedPromptUrlInstallIDs([])
    setPromptUrlInstallMessage(null)
  }

  function togglePromptUrlInstallPrompt(promptID: string) {
    setSelectedPromptUrlInstallIDs((current) =>
      current.includes(promptID)
        ? current.filter((id) => id !== promptID)
        : [...current, promptID],
    )
  }

  async function previewPromptUrlInstall() {
    const previewPromptUrlInstallApi = window.desktop?.previewPromptUrlInstall
    if (!previewPromptUrlInstallApi) {
      setPromptUrlInstallMessage({
        tone: "error",
        text: t("prompts.install.unavailable"),
      })
      return false
    }

    const source = promptUrlInstallSource.trim()
    if (!source) {
      setPromptUrlInstallMessage({
        tone: "error",
        text: t("prompts.install.enterUrl"),
      })
      return false
    }

    setIsPreviewingPromptUrlInstall(true)
    setPromptUrlInstallMessage(null)
    setPromptUrlInstallPreview(null)
    setSelectedPromptUrlInstallIDs([])

    try {
      const preview = await previewPromptUrlInstallApi({ source })
      const availablePromptIDs = preview.prompts
        .filter((prompt) => prompt.available)
        .map((prompt) => prompt.id)

      setPromptUrlInstallPreview(preview)
      setSelectedPromptUrlInstallIDs(availablePromptIDs)
      setPromptUrlInstallMessage(preview.prompts.length === 0
        ? {
            tone: "error",
            text: t("prompts.install.noPrompts"),
          }
        : null)
      return true
    } catch (error) {
      setPromptUrlInstallMessage({
        tone: "error",
        text: getErrorMessage(error),
      })
      return false
    } finally {
      setIsPreviewingPromptUrlInstall(false)
    }
  }

  async function installPromptsFromUrl() {
    const installPromptsFromUrlApi = window.desktop?.installPromptsFromUrl
    if (!promptUrlInstallPreview || isPreviewingPromptUrlInstall || isInstallingPromptUrlPrompts) return false

    if (!installPromptsFromUrlApi) {
      setPromptUrlInstallMessage({
        tone: "error",
        text: t("prompts.install.unavailable"),
      })
      return false
    }

    if (selectedPromptUrlInstallIDs.length === 0) {
      setPromptUrlInstallMessage({
        tone: "error",
        text: t("prompts.install.selectAtLeastOne"),
      })
      return false
    }

    if (
      isPromptDirty &&
      typeof window.confirm === "function" &&
      !window.confirm(t("prompts.install.discardConfirm"))
    ) {
      return false
    }

    setIsInstallingPromptUrlPrompts(true)
    setPromptUrlInstallMessage(null)

    try {
      const result = await installPromptsFromUrlApi({
        previewID: promptUrlInstallPreview.previewID,
        promptIDs: selectedPromptUrlInstallIDs,
      })
      const firstInstalledPrompt = result.installed[0] ?? null

      for (const document of result.installed) {
        syncPromptPresetSummary(document)
      }

      if (firstInstalledPrompt) {
        setPromptRoot(firstInstalledPrompt.root ?? promptRoot)
        setSelectedPromptPresetID(firstInstalledPrompt.id)
        setSelectedPromptPreset(firstInstalledPrompt)
        setPromptDraftLabel(firstInstalledPrompt.label)
        setSavedPromptLabel(firstInstalledPrompt.label)
        setPromptDraftContent(firstInstalledPrompt.content)
        setSavedPromptContent(firstInstalledPrompt.content)
      }

      setIsPromptUrlInstallDialogOpen(false)
      resetPromptUrlInstallDialog()
      showMessage({
        tone: "success",
        text: t("prompts.message.installedCount", {
          count: result.installed.length,
          plural: result.installed.length === 1 ? "" : "s",
        }),
      })
      return true
    } catch (error) {
      setPromptUrlInstallMessage({
        tone: "error",
        text: getErrorMessage(error),
      })
      return false
    } finally {
      setIsInstallingPromptUrlPrompts(false)
    }
  }

  async function translatePromptPreset(input: {
    languageID: PromptTranslationLanguageID
    model: string
  }) {
    const translatePromptPresetApi = window.desktop?.translatePromptPreset
    if (!selectedPromptPreset || !translatePromptPresetApi) {
      showMessage({
        tone: "error",
        text: t("prompts.message.translationUnavailable"),
      })
      return false
    }

    if (!promptDraftContent.trim()) {
      showMessage({
        tone: "error",
        text: t("prompts.message.contentEmpty"),
      })
      return false
    }

    if (!input.model.trim()) {
      showMessage({
        tone: "error",
        text: t("prompts.message.selectTranslationModel"),
      })
      return false
    }

    setIsTranslatingPromptPreset(true)

    try {
      const document = await translatePromptPresetApi({
        sourcePresetID: selectedPromptPreset.id,
        sourceLabel: promptDraftLabel || selectedPromptPreset.label,
        content: promptDraftContent,
        languageID: input.languageID,
        model: input.model,
      })
      syncPromptPresetSummary(document)
      setPromptRoot(document.root ?? promptRoot)
      showMessage({
        tone: "success",
        text: t("prompts.message.translatedSaved", { label: document.label }),
      })
      return true
    } catch (error) {
      showMessage({
        tone: "error",
        text: getErrorMessage(error),
      })
      return false
    } finally {
      setIsTranslatingPromptPreset(false)
    }
  }

  async function savePromptPreset() {
    if (!selectedPromptPresetID || !selectedPromptPreset || !window.desktop?.updatePromptPreset) return false

    setSavingPromptPresetID(selectedPromptPresetID)

    try {
      const document = await window.desktop.updatePromptPreset({
        presetID: selectedPromptPresetID,
        label: selectedPromptPreset.source === "custom" ? promptDraftLabel : undefined,
        content: promptDraftContent,
      })
      setSelectedPromptPreset(document)
      setSavedPromptLabel(document.label)
      setPromptDraftLabel(document.label)
      setSavedPromptContent(document.content)
      setPromptDraftContent(document.content)
      syncPromptPresetSummary(document)
      showMessage({
        tone: "success",
        text: t("prompts.message.saved"),
      })
      return true
    } catch (error) {
      showMessage({
        tone: "error",
        text: getErrorMessage(error),
      })
      return false
    } finally {
      setSavingPromptPresetID(null)
    }
  }

  async function resetPromptPreset() {
    if (
      !selectedPromptPresetID ||
      selectedPromptPreset?.source !== "bundled" ||
      !window.desktop?.resetPromptPreset
    ) {
      return false
    }

    setResettingPromptPresetID(selectedPromptPresetID)

    try {
      const document = await window.desktop.resetPromptPreset({
        presetID: selectedPromptPresetID,
      })
      setSelectedPromptPreset(document)
      setSavedPromptLabel(document.label)
      setPromptDraftLabel(document.label)
      setSavedPromptContent(document.content)
      setPromptDraftContent(document.content)
      syncPromptPresetSummary(document)
      showMessage({
        tone: "success",
        text: t("prompts.message.reset"),
      })
      return true
    } catch (error) {
      showMessage({
        tone: "error",
        text: getErrorMessage(error),
      })
      return false
    } finally {
      setResettingPromptPresetID(null)
    }
  }

  async function deletePromptPreset(presetID = selectedPromptPresetID) {
    const targetPromptPreset =
      promptPresets.find((preset) => preset.id === presetID) ??
      (selectedPromptPreset?.id === presetID ? selectedPromptPreset : null)
    if (
      !presetID ||
      targetPromptPreset?.source !== "custom" ||
      !window.desktop?.deletePromptPreset
    ) {
      return false
    }

    setDeletingPromptPresetID(presetID)

    try {
      const nextSelection = await window.desktop.deletePromptPreset({
        presetID,
      })
      const remainingPromptPresets = promptPresets.filter((preset) => preset.id !== presetID)
      setPromptPresets(remainingPromptPresets)
      setPromptPresetSelection(nextSelection)
      setSavedPromptPresetSelection(nextSelection)

      if (selectedPromptPresetID !== presetID) {
        showMessage({
          tone: "success",
          text: t("prompts.message.deleted"),
        })
        return true
      }

      const nextPresetID =
        remainingPromptPresets.find((preset) => preset.id === nextSelection.systemPromptPresetID)?.id ??
        remainingPromptPresets.find((preset) => preset.id === nextSelection.planModePromptPresetID)?.id ??
        remainingPromptPresets.find((preset) => preset.id === nextSelection.sideChatPromptPresetID)?.id ??
        remainingPromptPresets.find((preset) => preset.id === nextSelection.gitCommitPromptPresetID)?.id ??
        remainingPromptPresets[0]?.id ??
        null

      if (!nextPresetID) {
        setSelectedPromptPresetID(null)
        setSelectedPromptPreset(null)
        setPromptDraftLabel("")
        setSavedPromptLabel("")
        setPromptDraftContent("")
        setSavedPromptContent("")
      } else {
        await loadPromptPresetDocument(nextPresetID, { silent: true })
      }

      showMessage({
        tone: "success",
        text: t("prompts.message.deleted"),
      })
      return true
    } catch (error) {
      showMessage({
        tone: "error",
        text: getErrorMessage(error),
      })
      return false
    } finally {
      setDeletingPromptPresetID(null)
    }
  }

  async function saveProvider(providerID: string) {
    const updateProvider = window.desktop?.updateGlobalProvider
    if (!updateProvider) return false

    const provider = catalog.find((item) => item.id === providerID)
    if (!provider) return false

    const draft = providerDrafts[providerID] ?? {
      apiKey: "",
      baseURL: provider.baseURL ?? "",
      selectedAuthMethod: provider.authState.activeMethod ?? provider.authCapabilities[0]?.method ?? null,
      activeFlow: provider.authState.flow ?? null,
    }
    const baseURL = draft.baseURL.trim()
    const nextProvider: ProviderMutationPayload = {
      name: provider.name,
      env: provider.env,
    }
    const optionsPayload: NonNullable<ProviderMutationPayload["options"]> = {}

    if (baseURL !== (provider.baseURL ?? "")) {
      optionsPayload.baseURL = baseURL
    }

    if (Object.keys(optionsPayload).length > 0) {
      nextProvider.options = optionsPayload
    }

    if (!nextProvider.options) {
      showMessage({
        tone: "error",
        text: `No changes to save for ${provider.name}.`,
      })
      return false
    }

    setSavingProviderID(providerID)

    try {
      await updateProvider({
        providerID,
        provider: nextProvider,
      })
      await loadSettingsData({ silent: true })
      await notifyProviderModelsUpdated()
      showMessage({
        tone: "success",
        text: "Provider settings saved.",
      })
      return true
    } catch (error) {
      showMessage({
        tone: "error",
        text: getErrorMessage(error),
      })
      return false
    } finally {
      setSavingProviderID(null)
    }
  }

  async function saveCustomProvider(providerID?: string) {
    const upsertCustomProvider = window.desktop?.upsertCustomProvider
    if (!upsertCustomProvider) return false

    setSavingProviderID("custom")

    try {
      await upsertCustomProvider({
        providerID,
        apiBaseURL: customProviderDraft.apiBaseURL.trim(),
        apiKey: customProviderDraft.apiKey.trim(),
        defaultModel: customProviderDraft.defaultModel.trim(),
        chatEndpoint: customProviderDraft.chatEndpoint.trim(),
      })
      resetCustomProviderDraft()
      await loadSettingsData({ silent: true })
      await notifyProviderModelsUpdated()
      showMessage({
        tone: "success",
        text: "Custom provider saved.",
      })
      return true
    } catch (error) {
      showMessage({
        tone: "error",
        text: getErrorMessage(error),
      })
      return false
    } finally {
      setSavingProviderID(null)
    }
  }

  async function pollProviderAuthFlow(providerID: string, flowID: string) {
    if (!window.desktop?.getGlobalProviderAuthFlow) return

    while (true) {
      try {
        const flow = await window.desktop.getGlobalProviderAuthFlow({
          providerID,
          flowID,
        })

        setProviderDrafts((current) => ({
          ...current,
          [providerID]: {
            apiKey: current[providerID]?.apiKey ?? "",
            baseURL: current[providerID]?.baseURL ?? "",
            selectedAuthMethod: current[providerID]?.selectedAuthMethod ?? flow.method,
            activeFlow: flow,
          },
        }))

        if (["connected", "error", "expired", "cancelled"].includes(flow.status)) {
          await loadSettingsData({ silent: true })
          await notifyProviderModelsUpdated()

          if (flow.status === "connected") {
            showMessage({
              tone: "success",
              text: "Provider authentication connected.",
            })
          } else if (flow.status === "cancelled") {
            showMessage({
              tone: "error",
              text: flow.errorMessage ?? "Provider authentication was cancelled.",
            })
          } else {
            showMessage({
              tone: "error",
              text: getProviderAuthFailureMessage(providerID, flow),
            })
          }
          return
        }
      } catch (error) {
        showMessage({
          tone: "error",
          text: getErrorMessage(error),
        })
        return
      }

      await sleep(1500)
    }
  }

  async function startProviderAuthFlow(
    providerID: string,
    options: { prompt?: DesktopProviderAuthPrompt } = {},
  ) {
    if (!window.desktop?.startGlobalProviderAuthFlow) return false

    const provider = catalog.find((item) => item.id === providerID)
    const draft = providerDrafts[providerID]
    if (!provider) return false
    const method = resolveProviderAuthFlowMethod(provider, draft)
    if (!method) return false

    setSavingProviderID(providerID)

    try {
      const flow = await window.desktop.startGlobalProviderAuthFlow({
        providerID,
        method,
        baseURL: draft?.baseURL?.trim() || provider.baseURL || null,
        prompt: options.prompt,
      })

      setProviderDrafts((current) => ({
        ...current,
        [providerID]: {
          apiKey: current[providerID]?.apiKey ?? "",
          baseURL: current[providerID]?.baseURL ?? provider.baseURL ?? "",
          selectedAuthMethod: method,
          activeFlow: flow,
        },
      }))

      const continuationURL = flow.authorizationURL ?? flow.verificationURI
      if (continuationURL && window.desktop?.openExternalUrl) {
        await window.desktop.openExternalUrl({
          url: continuationURL,
        })
      }

      showMessage({
        tone: "success",
        text:
          flow.kind === "device_code"
            ? "Complete the device code sign-in in your browser."
            : "Continue the sign-in flow in your browser.",
      })

      void pollProviderAuthFlow(providerID, flow.id)
      return true
    } catch (error) {
      showMessage({
        tone: "error",
        text: getErrorMessage(error),
      })
      return false
    } finally {
      setSavingProviderID(null)
    }
  }

  async function cancelProviderAuthFlow(providerID: string) {
    const flowID = providerDrafts[providerID]?.activeFlow?.id
    if (!flowID || !window.desktop?.cancelGlobalProviderAuthFlow) return false

    setSavingProviderID(providerID)

    try {
      await window.desktop.cancelGlobalProviderAuthFlow({
        providerID,
        flowID,
      })
      await loadSettingsData({ silent: true })
      showMessage({
        tone: "success",
        text: "Provider authentication cancelled.",
      })
      return true
    } catch (error) {
      showMessage({
        tone: "error",
        text: getErrorMessage(error),
      })
      return false
    } finally {
      setSavingProviderID(null)
    }
  }

  async function saveProviderApiKey(providerID: string, nextApiKey?: string | null) {
    if (!window.desktop?.saveGlobalProviderApiKey) return false

    const apiKey =
      (nextApiKey === undefined ? providerDrafts[providerID]?.apiKey ?? "" : nextApiKey ?? "").trim()

    setSavingProviderID(providerID)

    try {
      await window.desktop.saveGlobalProviderApiKey({
        providerID,
        apiKey: apiKey || null,
      })
      await loadSettingsData({ silent: true })
      await notifyProviderModelsUpdated()
      showMessage({
        tone: "success",
        text: apiKey ? "API key saved." : "API key cleared.",
      })
      return true
    } catch (error) {
      showMessage({
        tone: "error",
        text: getErrorMessage(error),
      })
      return false
    } finally {
      setSavingProviderID(null)
    }
  }

  async function saveCinemaVideoProviderApiKey(providerID: string, nextApiKey?: string | null) {
    if (!window.desktop?.saveCinemaVideoProviderApiKey && !window.desktop?.saveCinemaVideoProviderSettings) return false

    const apiKey =
      (nextApiKey === undefined ? cinemaVideoProviderDrafts[providerID]?.apiKey ?? "" : nextApiKey ?? "").trim()
    const provider = cinemaVideoProviders.find((item) => item.manifest.id === providerID)
    const baseURL = (cinemaVideoProviderDrafts[providerID]?.baseURL ?? "").trim()
    const previousBaseURL = provider?.runtime?.configuredBaseURL ?? ""
    const shouldSaveApiKey = nextApiKey !== undefined || apiKey.length > 0
    const shouldSaveBaseURL = nextApiKey === undefined && baseURL !== previousBaseURL

    setSavingCinemaVideoProviderID(providerID)

    try {
      if (shouldSaveApiKey) {
        if (!window.desktop?.saveCinemaVideoProviderApiKey) return false
        await window.desktop.saveCinemaVideoProviderApiKey({
          providerID,
          apiKey: apiKey || null,
        })
      }
      if (shouldSaveBaseURL) {
        if (!window.desktop?.saveCinemaVideoProviderSettings) return false
        await window.desktop.saveCinemaVideoProviderSettings({
          providerID,
          baseURL: baseURL || null,
        })
      }
      await loadSettingsData({ silent: true, preserveProviderDrafts: true })
      showMessage({
        tone: "success",
        text: nextApiKey === null ? "Video provider API key cleared." : "Video provider settings saved.",
      })
      return true
    } catch (error) {
      showMessage({
        tone: "error",
        text: getErrorMessage(error),
      })
      return false
    } finally {
      setSavingCinemaVideoProviderID(null)
    }
  }

  async function deleteProviderAuthSession(providerID: string) {
    if (!window.desktop?.deleteGlobalProviderAuthSession) return false

    setSavingProviderID(providerID)

    try {
      await window.desktop.deleteGlobalProviderAuthSession({
        providerID,
      })
      await loadSettingsData({ silent: true })
      await notifyProviderModelsUpdated()
      showMessage({
        tone: "success",
        text: "Shared provider session removed.",
      })
      return true
    } catch (error) {
      showMessage({
        tone: "error",
        text: getErrorMessage(error),
      })
      return false
    } finally {
      setSavingProviderID(null)
    }
  }

  async function testProviderConnection(
    providerID: string,
    input: {
      method?: string
      credentialMode?: "active" | "manual" | "environment"
      apiKey?: string | null
      baseURL?: string | null
    } = {},
  ) {
    if (!window.desktop?.testGlobalProviderConnection) return false

    setTestingProviderID(providerID)

    try {
      const result = await window.desktop.testGlobalProviderConnection({
        providerID,
        ...input,
      })
      await loadSettingsData({ silent: true, preserveProviderDrafts: true })
      await notifyProviderModelsUpdated()
      showMessage({
        tone: result.ok ? "success" : "error",
        text: result.message,
      })
      return result.ok
    } catch (error) {
      showMessage({
        tone: "error",
        text: getErrorMessage(error),
      })
      return false
    } finally {
      setTestingProviderID(null)
    }
  }

  async function testCinemaVideoProviderConnection(providerID: string) {
    if (!window.desktop?.testCinemaVideoProviderConnection) return false

    const draft = cinemaVideoProviderDrafts[providerID]
    const apiKey = draft?.apiKey.trim()
    const baseURL = draft?.baseURL.trim()

    setTestingProviderID(`${CINEMA_VIDEO_PROVIDER_TEST_PREFIX}${providerID}`)

    try {
      const result = await window.desktop.testCinemaVideoProviderConnection({
        providerID,
        ...(apiKey ? { apiKey } : {}),
        ...(baseURL ? { baseURL } : {}),
      })
      await loadSettingsData({ silent: true, preserveProviderDrafts: true })
      showMessage({
        tone: result.ok ? "success" : "error",
        text: result.message,
      })
      return result.ok
    } catch (error) {
      showMessage({
        tone: "error",
        text: getErrorMessage(error),
      })
      return false
    } finally {
      setTestingProviderID(null)
    }
  }

  async function testCustomProviderConnection(providerID?: string) {
    if (!window.desktop?.testCustomProviderConnection) return false

    setTestingProviderID("custom")

    try {
      const result = await window.desktop.testCustomProviderConnection({
        providerID,
        apiBaseURL: customProviderDraft.apiBaseURL.trim(),
        apiKey: customProviderDraft.apiKey.trim(),
        defaultModel: customProviderDraft.defaultModel.trim(),
        chatEndpoint: customProviderDraft.chatEndpoint.trim(),
      })
      showMessage({
        tone: result.ok ? "success" : "error",
        text: result.message,
      })
      return result.ok
    } catch (error) {
      showMessage({
        tone: "error",
        text: getErrorMessage(error),
      })
      return false
    } finally {
      setTestingProviderID(null)
    }
  }

  async function refreshProviderCatalog() {
    const refreshProviderCatalogApi = window.desktop?.refreshGlobalProviderCatalog

    if (!refreshProviderCatalogApi) {
      showMessage({
        tone: "error",
        text: "Desktop provider refresh API is unavailable.",
      })
      return false
    }

    setIsRefreshingProviderCatalog(true)

    try {
      await refreshProviderCatalogApi()
      await loadSettingsData({ silent: true })
      await notifyProviderModelsUpdated()
      showMessage({
        tone: "success",
        text: "Provider catalog refreshed.",
      })
      return true
    } catch (error) {
      showMessage({
        tone: "error",
        text: getErrorMessage(error),
      })
      return false
    } finally {
      setIsRefreshingProviderCatalog(false)
    }
  }

  async function refreshCinemaVideoProviderCatalog() {
    const refreshVideoProviderCatalogApi = window.desktop?.refreshCinemaVideoProviderCatalog
    if (!refreshVideoProviderCatalogApi) {
      showMessage({
        tone: "error",
        text: "Desktop video provider refresh API is unavailable.",
      })
      return false
    }

    setIsRefreshingCinemaVideoProviderCatalog(true)

    try {
      const nextCinemaVideoProviders = await refreshVideoProviderCatalogApi()
      setCinemaVideoProviders(nextCinemaVideoProviders)
      const nextCinemaVideoProviderDrafts = buildCinemaVideoProviderDrafts(nextCinemaVideoProviders)
      setCinemaVideoProviderDrafts((current) => mergeCinemaVideoProviderDrafts(nextCinemaVideoProviderDrafts, current))
      showMessage({
        tone: "success",
        text: "Video provider catalog refreshed.",
      })
      return true
    } catch (error) {
      showMessage({
        tone: "error",
        text: getErrorMessage(error),
      })
      return false
    } finally {
      setIsRefreshingCinemaVideoProviderCatalog(false)
    }
  }

  async function deleteProvider(providerID: string) {
    const removeProvider = window.desktop?.deleteGlobalProvider
    if (!removeProvider) return

    setDeletingProviderID(providerID)

    try {
      await removeProvider({
        providerID,
      })
      await loadSettingsData({ silent: true })
      await notifyProviderModelsUpdated()
      showMessage({
        tone: "success",
        text: "Provider settings reset.",
      })
    } catch (error) {
      showMessage({
        tone: "error",
        text: getErrorMessage(error),
      })
    } finally {
      setDeletingProviderID(null)
    }
  }

  async function saveSelection(nextSelection: ProjectModelSelection = selectionDraftRef.current) {
    const updateModelSelection = window.desktop?.updateGlobalModelSelection
    if (!updateModelSelection) return

    pendingSelectionSaveRef.current = nextSelection
    if (isPersistingSelectionRef.current) return

    isPersistingSelectionRef.current = true
    setIsSavingSelection(true)

    try {
      let didSave = false

      while (pendingSelectionSaveRef.current) {
        const selectionToSave = pendingSelectionSaveRef.current
        pendingSelectionSaveRef.current = null

        await updateModelSelection(buildModelSelectionUpdatePayload(savedSelectionRef.current, selectionToSave))
        savedSelectionRef.current = selectionToSave
        setSavedSelection(selectionToSave)
        didSave = true
      }

      if (didSave) {
        await notifyProviderModelsUpdated()
        showMessage({
          tone: "success",
          text: "Model settings saved.",
        })
      }
    } catch (error) {
      showMessage({
        tone: "error",
        text: getErrorMessage(error),
      })
    } finally {
      isPersistingSelectionRef.current = false
      setIsSavingSelection(false)
      if (pendingSelectionSaveRef.current) {
        void saveSelection(pendingSelectionSaveRef.current)
      }
    }
  }

  async function saveMcpServer() {
    if (!window.desktop?.updateGlobalMcpServer) return false

    const serverID = mcpServerDraft.id.trim()
    const validationError = getMcpServerValidationError(mcpServerDraft)
    if (validationError) {
      showMessage({
        tone: "error",
        text: validationError,
      })
      return false
    }

    setSavingMcpServerID(serverID)

    try {
      await window.desktop.updateGlobalMcpServer({
        serverID,
        server:
          mcpServerDraft.transport === "stdio"
            ? {
                name: mcpServerDraft.name.trim() || undefined,
                transport: "stdio",
                command: mcpServerDraft.command.trim(),
                args: parseLineList(mcpServerDraft.args),
                env: parseMcpKeyValue(mcpServerDraft.env, "environment"),
                cwd: mcpServerDraft.cwd.trim() || undefined,
                toolPolicies: buildToolPolicies(mcpServerDraft),
                enabled: mcpServerDraft.enabled,
                timeoutMs: mcpServerDraft.timeoutMs.trim() ? Number(mcpServerDraft.timeoutMs.trim()) : undefined,
              }
            : mcpServerDraft.transport === "remote"
              ? {
                name: mcpServerDraft.name.trim() || undefined,
                transport: "remote",
                serverUrl: mcpServerDraft.serverUrl.trim(),
                authorization: mcpServerDraft.authorization.trim() || undefined,
                headers: parseMcpKeyValue(mcpServerDraft.headers, "header"),
                allowedTools: buildAllowedTools(mcpServerDraft),
                toolPolicies: buildToolPolicies(mcpServerDraft),
                enabled: mcpServerDraft.enabled,
                timeoutMs: mcpServerDraft.timeoutMs.trim() ? Number(mcpServerDraft.timeoutMs.trim()) : undefined,
              }
              : {
                  name: mcpServerDraft.name.trim() || undefined,
                  transport: "connector",
                  connectorId: mcpServerDraft.connectorId.trim(),
                  allowedTools: buildAllowedTools(mcpServerDraft),
                  toolPolicies: buildToolPolicies(mcpServerDraft),
                  enabled: mcpServerDraft.enabled,
                  timeoutMs: mcpServerDraft.timeoutMs.trim() ? Number(mcpServerDraft.timeoutMs.trim()) : undefined,
                },
      })
      await loadMcpServers({ silent: true })
      await notifyMcpUpdated()
      setActiveMcpServerID(serverID)
      const diagnostic = await loadMcpServerDiagnostic(serverID)
      showMessage(diagnostic ? formatMcpDiagnosticMessage(diagnostic) : {
        tone: "success",
        text: "MCP server saved.",
      })
      return true
    } catch (error) {
      showMessage({
        tone: "error",
        text: getErrorMessage(error),
      })
      return false
    } finally {
      setSavingMcpServerID(null)
    }
  }

  async function importMcpConfigJson(input: string) {
    if (!window.desktop?.updateGlobalMcpServer) return false

    let parsed: ReturnType<typeof parseMcpConfigJson>
    try {
      parsed = parseMcpConfigJson(input)
    } catch (error) {
      showMessage({
        tone: "error",
        text: getErrorMessage(error),
      })
      return false
    }

    setIsImportingMcpConfigJson(true)

    try {
      for (const imported of parsed.servers) {
        await window.desktop.updateGlobalMcpServer({
          serverID: imported.id,
          server: imported.server,
        })
      }

      await loadMcpServers({ silent: true })
      await notifyMcpUpdated()

      const activeImported = parsed.servers[parsed.servers.length - 1]
      if (activeImported) {
        setActiveMcpServerID(activeImported.id)
        setMcpServerDraft(toMcpDraft({
          id: activeImported.id,
          ...activeImported.server,
        } as McpServerSummary))
      }

      const warningText = parsed.warnings.length > 0
        ? ` ${parsed.warnings.slice(0, 2).join(" ")}${parsed.warnings.length > 2 ? " ..." : ""}`
        : ""
      showMessage({
        tone: "success",
        text: `Imported ${parsed.servers.length} MCP server${parsed.servers.length === 1 ? "" : "s"}.${warningText}`,
      })
      return true
    } catch (error) {
      showMessage({
        tone: "error",
        text: getErrorMessage(error),
      })
      return false
    } finally {
      setIsImportingMcpConfigJson(false)
    }
  }

  async function deleteMcpServer(serverID: string) {
    if (!window.desktop?.deleteGlobalMcpServer) return

    setDeletingMcpServerID(serverID)

    try {
      await window.desktop.deleteGlobalMcpServer({
        serverID,
      })
      await loadMcpServers({ silent: true })
      await notifyMcpUpdated()
      if (activeMcpServerID === serverID) {
        startNewMcpServer()
      }
      setMcpDiagnostics((current) => {
        const next = { ...current }
        delete next[serverID]
        return next
      })
      showMessage({
        tone: "success",
        text: "MCP server removed.",
      })
    } catch (error) {
      showMessage({
        tone: "error",
        text: getErrorMessage(error),
      })
    } finally {
      setDeletingMcpServerID(null)
    }
  }

  async function installPlugin(pluginID: string) {
    if (!window.desktop?.installPlugin) return false

    const plugin = pluginCatalog.find((item) => item.id === pluginID)
    if (!plugin) return false

    setInstallingPluginID(pluginID)

    try {
      const installed = await window.desktop.installPlugin({
        pluginID,
        config: pluginDraft.pluginID === pluginID ? pluginDraft.config : buildPluginDraft(plugin).config,
        enabled: true,
      })
      await loadPlugins({ silent: true })
      await notifyPluginCapabilitiesUpdated()
      setActivePluginSelection(pluginID)
      setPluginDraft(buildPluginDraft(plugin, installed))
      showMessage({
        tone: "success",
        text: `${plugin.name} installed. Enable it for a project from the MCP picker when needed.`,
      })
      return true
    } catch (error) {
      showMessage({
        tone: "error",
        text: getErrorMessage(error),
      })
      return false
    } finally {
      setInstallingPluginID(null)
    }
  }

  async function importPluginFromURL(url: string) {
    const importPluginFromURLAPI = window.desktop?.importPluginFromURL
    if (!importPluginFromURLAPI) {
      throw new Error("当前桌面进程尚未加载插件 URL 导入通道，请重启 Anybox。")
    }

    const trimmedURL = url.trim()
    if (!trimmedURL) {
      throw new Error("Plugin URL is required.")
    }

    try {
      const plugin = await importPluginFromURLAPI({ url: trimmedURL })
      setActivePluginSelection(plugin.id)
      await loadPlugins({ silent: true })
      showMessage({
        tone: "success",
        text: plugin.installable === false
          ? `${plugin.name} imported. Add package metadata before installing it.`
          : `${plugin.name} imported. Review it before installing.`,
      })
      return true
    } catch (error) {
      const message = getErrorMessage(error)
      showMessage({
        tone: "error",
        text: message,
      })
      throw new Error(message)
    }
  }

  async function updateInstalledPlugin(pluginID: string, update?: { config?: Record<string, string>; enabled?: boolean }) {
    if (!window.desktop?.updateInstalledPlugin) return false

    const plugin = pluginCatalog.find((item) => item.id === pluginID)
    if (!plugin) return false

    setUpdatingPluginID(pluginID)

    try {
      const installed = await window.desktop.updateInstalledPlugin({
        pluginID,
        ...update,
      })
      await loadPlugins({ silent: true })
      await notifyPluginCapabilitiesUpdated()
      setActivePluginSelection(pluginID)
      setPluginDraft(buildPluginDraft(plugin, installed))
      showMessage({
        tone: "success",
        text: `${plugin.name} updated.`,
      })
      return true
    } catch (error) {
      showMessage({
        tone: "error",
        text: getErrorMessage(error),
      })
      return false
    } finally {
      setUpdatingPluginID(null)
    }
  }

  async function saveInstalledPluginConfig(pluginID: string) {
    return updateInstalledPlugin(pluginID, {
      config: pluginDraft.config,
    })
  }

  async function setInstalledPluginEnabled(pluginID: string, enabled: boolean) {
    return updateInstalledPlugin(pluginID, {
      enabled,
    })
  }

  async function deleteInstalledPlugin(pluginID: string) {
    if (!window.desktop?.deleteInstalledPlugin) return false

    setDeletingPluginID(pluginID)

    try {
      await window.desktop.deleteInstalledPlugin({
        pluginID,
      })
      await loadPlugins({ silent: true })
      await notifyPluginCapabilitiesUpdated()
      setPluginDiagnostics((current) => {
        const next = { ...current }
        delete next[pluginID]
        return next
      })
      setPluginConnectorStatuses((current) => {
        const next = { ...current }
        delete next[pluginID]
        return next
      })
      showMessage({
        tone: "success",
        text: "Plugin removed.",
      })
      return true
    } catch (error) {
      showMessage({
        tone: "error",
        text: getErrorMessage(error),
      })
      return false
    } finally {
      setDeletingPluginID(null)
    }
  }

  async function diagnoseInstalledPlugin(pluginID: string) {
    setDiagnosingPluginID(pluginID)

    try {
      const diagnostic = await loadPluginDiagnostic(pluginID)
      if (!diagnostic) return false
      await loadPlugins({ silent: true })
      showMessage(formatMcpDiagnosticMessage(diagnostic, "diagnose"))
      return diagnostic.ok
    } finally {
      setDiagnosingPluginID(null)
    }
  }

  async function saveInstalledPluginConnectorApiKey(pluginID: string, appID: string) {
    if (!window.desktop?.saveInstalledPluginConnectorApiKey) return false

    const connectorKey = `${pluginID}:${appID}`
    const apiKey = pluginDraft.appApiKeys[appID]?.trim() ?? ""
    setSavingPluginConnectorID(connectorKey)

    try {
      await window.desktop.saveInstalledPluginConnectorApiKey({
        pluginID,
        appID,
        apiKey: apiKey || null,
      })
      await loadPluginConnectorStatuses(pluginID)
      await notifyMcpUpdated()
      setPluginDraftAppApiKey(appID, "")
      showMessage({
        tone: "success",
        text: apiKey ? "App connector API key saved." : "App connector API key cleared.",
      })
      return true
    } catch (error) {
      showMessage({
        tone: "error",
        text: getErrorMessage(error),
      })
      return false
    } finally {
      setSavingPluginConnectorID(null)
    }
  }

  async function deleteInstalledPluginConnectorApiKey(pluginID: string, appID: string) {
    if (!window.desktop?.deleteInstalledPluginConnectorApiKey) return false

    const connectorKey = `${pluginID}:${appID}`
    setSavingPluginConnectorID(connectorKey)

    try {
      await window.desktop.deleteInstalledPluginConnectorApiKey({ pluginID, appID })
      await loadPluginConnectorStatuses(pluginID)
      await notifyMcpUpdated()
      showMessage({
        tone: "success",
        text: "App connector disconnected.",
      })
      return true
    } catch (error) {
      showMessage({
        tone: "error",
        text: getErrorMessage(error),
      })
      return false
    } finally {
      setSavingPluginConnectorID(null)
    }
  }

  async function pollInstalledPluginConnectorAuthFlow(pluginID: string, appID: string, flowID: string) {
    if (!window.desktop?.getInstalledPluginConnectorAuthFlow) return

    while (true) {
      try {
        const flow = await window.desktop.getInstalledPluginConnectorAuthFlow({
          pluginID,
          appID,
          flowID,
        })
        if (!flow) return

        await loadPluginConnectorStatuses(pluginID)

        if (["connected", "error", "expired", "cancelled"].includes(flow.status)) {
          await notifyMcpUpdated()
          if (flow.status === "connected") {
            showMessage({
              tone: "success",
              text: "App connector signed in.",
            })
          } else if (flow.status === "cancelled") {
            showMessage({
              tone: "error",
              text: flow.errorMessage ?? "App connector sign-in was cancelled.",
            })
          } else {
            showMessage({
              tone: "error",
              text: flow.errorMessage ?? "App connector sign-in failed.",
            })
          }
          return
        }
      } catch (error) {
        showMessage({
          tone: "error",
          text: getErrorMessage(error),
        })
        return
      }

      await sleep(1500)
    }
  }

  async function startInstalledPluginConnectorAuthFlow(pluginID: string, appID: string) {
    if (!window.desktop?.startInstalledPluginConnectorAuthFlow) return false

    const connectorKey = `${pluginID}:${appID}`
    setSavingPluginConnectorID(connectorKey)

    try {
      const flow = await window.desktop.startInstalledPluginConnectorAuthFlow({ pluginID, appID })
      await loadPluginConnectorStatuses(pluginID)

      if (flow.authorizationURL && window.desktop?.openExternalUrl) {
        await window.desktop.openExternalUrl({ url: flow.authorizationURL })
      }

      showMessage({
        tone: "success",
        text: "Continue the app connector sign-in flow in your browser.",
      })
      void pollInstalledPluginConnectorAuthFlow(pluginID, appID, flow.id)
      return true
    } catch (error) {
      showMessage({
        tone: "error",
        text: getErrorMessage(error),
      })
      return false
    } finally {
      setSavingPluginConnectorID(null)
    }
  }

  async function cancelInstalledPluginConnectorAuthFlow(pluginID: string, appID: string) {
    const flowID = pluginConnectorStatuses[pluginID]?.find((status) => status.appID === appID)?.activeFlow?.id
    if (!flowID || !window.desktop?.cancelInstalledPluginConnectorAuthFlow) return false

    const connectorKey = `${pluginID}:${appID}`
    setSavingPluginConnectorID(connectorKey)

    try {
      await window.desktop.cancelInstalledPluginConnectorAuthFlow({ pluginID, appID, flowID })
      await loadPluginConnectorStatuses(pluginID)
      showMessage({
        tone: "success",
        text: "App connector sign-in cancelled.",
      })
      return true
    } catch (error) {
      showMessage({
        tone: "error",
        text: getErrorMessage(error),
      })
      return false
    } finally {
      setSavingPluginConnectorID(null)
    }
  }

  async function deleteInstalledPluginConnectorAuthSession(pluginID: string, appID: string) {
    if (!window.desktop?.deleteInstalledPluginConnectorAuthSession) return false

    const connectorKey = `${pluginID}:${appID}`
    setSavingPluginConnectorID(connectorKey)

    try {
      await window.desktop.deleteInstalledPluginConnectorAuthSession({ pluginID, appID })
      await loadPluginConnectorStatuses(pluginID)
      await notifyMcpUpdated()
      showMessage({
        tone: "success",
        text: "App connector disconnected.",
      })
      return true
    } catch (error) {
      showMessage({
        tone: "error",
        text: getErrorMessage(error),
      })
      return false
    } finally {
      setSavingPluginConnectorID(null)
    }
  }

  async function diagnoseInstalledPluginConnector(pluginID: string, appID: string) {
    if (!window.desktop?.getInstalledPluginConnectorDiagnostic) return false

    const connectorKey = `${pluginID}:${appID}`
    setDiagnosingPluginConnectorID(connectorKey)

    try {
      const diagnostic = await window.desktop.getInstalledPluginConnectorDiagnostic({ pluginID, appID })
      await loadPluginConnectorStatuses(pluginID)
      showMessage(formatMcpDiagnosticMessage(diagnostic, "diagnose"))
      return diagnostic.ok
    } catch (error) {
      showMessage({
        tone: "error",
        text: getErrorMessage(error),
      })
      return false
    } finally {
      setDiagnosingPluginConnectorID(null)
    }
  }

  async function restoreArchivedSession(sessionID: string) {
    const restoreArchivedSessionApi = window.desktop?.restoreArchivedSession
    if (!restoreArchivedSessionApi) return false

    setRestoringArchivedSessionID(sessionID)

    try {
      const result = await restoreArchivedSessionApi({ sessionID })
      await loadArchivedSessions({ silent: true })
      await notifyArchivedSessionRestored(result.session)
      showMessage({
        tone: "success",
        text: "Archived session restored.",
      })
      return true
    } catch (error) {
      showMessage({
        tone: "error",
        text: getErrorMessage(error),
      })
      return false
    } finally {
      setRestoringArchivedSessionID(null)
    }
  }

  async function deleteArchivedSession(sessionID: string) {
    const deleteArchivedSessionApi = window.desktop?.deleteArchivedSession
    if (!deleteArchivedSessionApi) return false

    setDeletingArchivedSessionID(sessionID)

    try {
      await deleteArchivedSessionApi({ sessionID })
      await loadArchivedSessions({ silent: true })
      showMessage({
        tone: "success",
        text: "Archived session deleted.",
      })
      return true
    } catch (error) {
      showMessage({
        tone: "error",
        text: getErrorMessage(error),
      })
      return false
    } finally {
      setDeletingArchivedSessionID(null)
    }
  }

  async function deleteAllArchivedSessions(sessionIDs: string[]) {
    const deleteArchivedSessionApi = window.desktop?.deleteArchivedSession
    const targetSessionIDs = Array.from(new Set(sessionIDs.map((sessionID) => sessionID.trim()).filter(Boolean)))
    if (!deleteArchivedSessionApi || targetSessionIDs.length === 0 || isDeletingAllArchivedSessions) return false

    setIsDeletingAllArchivedSessions(true)
    try {
      for (const sessionID of targetSessionIDs) {
        await deleteArchivedSessionApi({ sessionID })
      }
      await loadArchivedSessions({ silent: true })
      showMessage({
        tone: "success",
        text: targetSessionIDs.length === 1
          ? "Archived session deleted."
          : `${targetSessionIDs.length} archived sessions deleted.`,
      })
      return true
    } catch (error) {
      await loadArchivedSessions({ silent: true })
      showMessage({
        tone: "error",
        text: getErrorMessage(error),
      })
      return false
    } finally {
      setIsDeletingAllArchivedSessions(false)
    }
  }

  const isPromptDirty =
    selectedPromptPresetID !== null &&
    (promptDraftLabel !== savedPromptLabel || promptDraftContent !== savedPromptContent)
  const isSystemPromptPresetDirty =
    promptPresetSelection !== null &&
    savedPromptPresetSelection !== null &&
    promptPresetSelection.systemPromptPresetID !== savedPromptPresetSelection.systemPromptPresetID
  const isPlanModePromptPresetDirty =
    promptPresetSelection !== null &&
    savedPromptPresetSelection !== null &&
    promptPresetSelection.planModePromptPresetID !== savedPromptPresetSelection.planModePromptPresetID
  const isSideChatPromptPresetDirty =
    promptPresetSelection !== null &&
    savedPromptPresetSelection !== null &&
    promptPresetSelection.sideChatPromptPresetID !== savedPromptPresetSelection.sideChatPromptPresetID
  const isGitCommitPromptPresetDirty =
    promptPresetSelection !== null &&
    savedPromptPresetSelection !== null &&
    promptPresetSelection.gitCommitPromptPresetID !== savedPromptPresetSelection.gitCommitPromptPresetID
  const isBuiltinToolSelectionDirty =
    stableSelectionKey(builtinToolSelection) !== stableSelectionKey(savedBuiltinToolSelection)

  return {
    activeMcpServerID,
    activeMcpServerDiagnostic: activeMcpServerID ? mcpDiagnostics[activeMcpServerID] ?? null : null,
    activeConnectorID,
    activePluginID,
    archivedSessions,
    archivedSessionsError,
    builtinTools,
    builtinToolsError,
    cancelConnectorAuthFlow,
    cancelInstalledPluginConnectorAuthFlow,
    cancelProviderAuthFlow,
    catalog,
    cinemaVideoProviders,
    closeSettings,
    connectorApiKeyDrafts,
    connectorCatalog,
    connectorConfigDrafts,
    connectorsError,
    connectorStatuses,
    deleteConnectorApiKey,
    deleteConnectorConfig,
    deleteConnectorAuthSession,
    deleteAllArchivedSessions,
    deleteArchivedSession,
    deleteInstalledPlugin,
    deleteProviderAuthSession,
    deleteMcpServer,
    deleteProvider,
    deleteInstalledPluginConnectorAuthSession,
    deletingArchivedSessionID,
    deletingMcpServerID,
    deletingPluginID,
    deletingPromptPresetID,
    deletingProviderID,
    deleteInstalledPluginConnectorApiKey,
    diagnoseConnector,
    diagnoseInstalledPlugin,
    diagnoseInstalledPluginConnector,
    diagnosingPluginID,
    diagnosingPluginConnectorID,
    diagnosingConnectorID,
    importPluginFromURL,
    installPlugin,
    installPromptsFromUrl,
    importMcpConfigJson,
    installingPluginID,
    installedPlugins,
    loadArchivedSessions,
    isCreatingPromptPreset,
    isImportingMcpConfigJson,
    isLoading,
    isLoadingBuiltinTools,
    isLoadingConnectors,
    isLoadingPlugins,
    isLoadingPromptPreset,
    isLoadingPrompts,
    isLoadingArchivedSessions,
    isDeletingAllArchivedSessions,
    isOpen,
    isPromptDirty,
    isPromptUrlInstallDialogOpen,
    isBuiltinToolSelectionDirty,
    isSystemPromptPresetDirty,
    isPlanModePromptPresetDirty,
    isSideChatPromptPresetDirty,
    isGitCommitPromptPresetDirty,
    isRefreshingProviderCatalog,
    isRefreshingCinemaVideoProviderCatalog,
    isInstallingPromptUrlPrompts,
    isPreviewingPromptUrlInstall,
    isTranslatingPromptPreset,
    isSavingPromptPresetSelection,
    isSavingBuiltinTools,
    isSavingSelection,
    loadError,
    mcpServerDraft,
    mcpServers,
    models,
    modelCatalog,
    openSettings,
    pluginCatalog,
    pluginConnectorStatuses,
    pluginDiagnostics,
    pluginDraft,
    pluginsError,
    promptDraftLabel,
    promptDraftContent,
    promptLoadError,
    promptRoot,
    promptPresets,
    promptPresetSelection,
    promptUrlInstallMessage,
    promptUrlInstallPreview,
    promptUrlInstallSource,
    providerDrafts,
    cinemaVideoProviderDrafts,
    customProviderDraft,
    createPromptPreset,
    deletePromptPreset,
    closePromptUrlInstallDialog,
    openPromptFolder,
    openPromptUrlInstallDialog,
    previewPromptUrlInstall,
    refreshProviderCatalog,
    refreshCinemaVideoProviderCatalog,
    resetPromptPreset,
    resetBuiltinTools,
    resettingPromptPresetID,
    restoringArchivedSessionID,
    savedSelection,
    saveMcpServer,
    saveConnectorApiKey,
    saveConnectorConfig,
    saveBuiltinTools,
    saveInstalledPluginConfig,
    saveInstalledPluginConnectorApiKey,
    savePromptPreset,
    savePromptPresetSelection,
    savingPromptPresetSelectionField,
    saveProviderApiKey,
    saveCinemaVideoProviderApiKey,
    saveProvider,
    saveCustomProvider,
    saveSelection,
    savingMcpServerID,
    savingConnectorID,
    savingPluginConnectorID,
    savingPromptPresetID,
    savingProviderID,
    savingCinemaVideoProviderID,
    testCinemaVideoProviderConnection,
    testProviderConnection,
    testCustomProviderConnection,
    testingProviderID,
    translatePromptPreset,
    selectedPromptPreset,
    selectedPromptUrlInstallIDs,
    setProviderAuthMethod,
    setPromptDraftLabelValue,
    setPromptPresetSelectionValue,
    setPromptUrlInstallSourceValue,
    selectPromptPreset,
    selectConnector,
    selectMcpServer,
    selectPlugin,
    clearPluginSelection,
    selectionDraft,
    setMcpServerDraftValue,
    setMcpToolPolicy,
    setInstalledPluginEnabled,
    setConnectorApiKeyDraft,
    setConnectorConfigDraft,
    setPluginDraftAppApiKey,
    setPluginDraftConfigValue,
    setPromptDraftValue,
    setProviderDraftValue,
    setCinemaVideoProviderDraftValue,
    setCustomProviderDraftValue,
    resetCustomProviderDraft,
    setSelectionDraftValue,
    togglePromptUrlInstallPrompt,
    setBuiltinToolEnabled,
    startInstalledPluginConnectorAuthFlow,
    startConnectorAuthFlow,
    startProviderAuthFlow,
    startNewMcpServer,
    restoreArchivedSession,
    updatingPluginID,
  }
}
