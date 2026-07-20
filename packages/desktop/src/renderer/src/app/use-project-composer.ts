import { useEffect, useLayoutEffect, useRef, useState } from "react"
import {
  getDefaultReasoningEffort as getProviderDefaultReasoningEffort,
  getSupportedReasoningEfforts as getProviderSupportedReasoningEfforts,
  supportsReasoningEffort,
  type ReasoningEffort,
} from "@anybox/shared"
import {
  describeComposerAttachmentSupport,
  getComposerAttachmentCapabilities,
  getComposerAttachmentDisabledReason,
  getComposerAttachmentError,
  isComposerAttachmentSupported,
} from "./composer/attachment-utils"
import { arePluginCatalogsEqual } from "./plugin-catalog"
import type {
  ComposerMcpOption,
  ComposerModelOption,
  ComposerPluginOption,
  ComposerReasoningEffortOption,
  ComposerSkillOption,
  InstalledPlugin,
  McpServerSummary,
  PluginCatalogItem,
  ProviderModel,
  SessionModelSelection,
  SkillInfo,
} from "./types"
const REASONING_EFFORT_COPY: Record<
  ReasoningEffort,
  {
    label: string
    description: string
  }
> = {
  none: {
    label: "None",
    description: "Skip deliberate reasoning for the fastest compatible response.",
  },
  minimal: {
    label: "Minimal",
    description: "Use a very shallow reasoning pass to reduce latency and reasoning tokens.",
  },
  low: {
    label: "Low",
    description: "Keep reasoning light for routine implementation and review tasks.",
  },
  medium: {
    label: "Medium",
    description: "Balance speed and depth for most coding work.",
  },
  high: {
    label: "High",
    description: "Spend more compute on harder or more ambiguous tasks.",
  },
  xhigh: {
    label: "X-High",
    description: "Use the deepest supported reasoning setting for long-horizon work.",
  },
  max: {
    label: "Max",
    description: "Use the maximum supported reasoning setting for the most complex tasks.",
  },
}

function toComposerModelValue(model: ProviderModel) {
  return `${model.providerID}/${model.id}`
}

function resolveComposerModelSelection(selectedModel: string | null, models: ProviderModel[]) {
  if (!selectedModel) return null

  const exactMatch = models.find((model) => toComposerModelValue(model) === selectedModel)
  if (exactMatch) return exactMatch
  if (selectedModel.includes("/")) return null

  const modelIDMatches = models.filter((model) => model.id === selectedModel)
  return modelIDMatches.length === 1 ? modelIDMatches[0] : null
}

function toComposerModelLabel(model: ProviderModel) {
  return model.name
}

const COMPOSER_PROVIDER_LABEL_OVERRIDES: Record<string, string> = {
  anthropic: "Anthropic",
  deepseek: "DeepSeek",
  google: "Google",
  groq: "Groq",
  mistral: "Mistral",
  ollama: "Ollama",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  xai: "xAI",
}

function formatComposerProviderID(providerID: string) {
  const normalized = providerID.trim()
  if (!normalized) return "Unknown provider"

  const override = COMPOSER_PROVIDER_LABEL_OVERRIDES[normalized.toLowerCase()]
  if (override) return override

  return normalized
    .replace(/[-_]+/g, " ")
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
}

function toComposerModelProviderLabel(model: ProviderModel) {
  return model.providerName?.trim() || formatComposerProviderID(model.providerID)
}

function toReasoningProfile(model: ProviderModel) {
  return {
    providerID: model.providerID,
    modelID: model.id,
    reasoning: model.capabilities.reasoning,
  }
}

function isReasoningEffortModel(model: ProviderModel | null): model is ProviderModel {
  return Boolean(model && supportsReasoningEffort(toReasoningProfile(model)))
}

function resolveComposerReasoningEffortOptions(model: ProviderModel | null): ComposerReasoningEffortOption[] {
  if (!isReasoningEffortModel(model)) return []

  return getProviderSupportedReasoningEfforts(toReasoningProfile(model)).map((value) => ({
    value,
    label: REASONING_EFFORT_COPY[value].label,
    description: REASONING_EFFORT_COPY[value].description,
  }))
}

function resolveDefaultReasoningEffort(
  model: ProviderModel | null,
  options: ComposerReasoningEffortOption[],
): ReasoningEffort | null {
  if (!isReasoningEffortModel(model) || options.length === 0) return null
  return getProviderDefaultReasoningEffort(toReasoningProfile(model)) ?? null
}

function resolveSelectedReasoningEffort(
  selectedReasoningEffort: ReasoningEffort | null,
  defaultReasoningEffort: ReasoningEffort | null,
  options: ComposerReasoningEffortOption[],
) {
  if (selectedReasoningEffort && options.some((option) => option.value === selectedReasoningEffort)) {
    return selectedReasoningEffort
  }

  return defaultReasoningEffort
}

function resolveComposerEffectiveModel(
  selectedModel: string | null,
  models: ProviderModel[],
  defaultModel: ProviderModel | null,
) {
  if (!selectedModel) return defaultModel
  return resolveComposerModelSelection(selectedModel, models) ?? defaultModel
}

function resolveComposerModelLabel(
  selectedModel: string | null,
  models: ProviderModel[],
  effectiveModel: ProviderModel | null,
  isLoading: boolean,
) {
  if (isLoading && models.length === 0 && !effectiveModel) return "Loading..."
  if (!selectedModel) {
    return effectiveModel ? `Server default (${effectiveModel.name})` : "Server default"
  }
  return resolveComposerModelSelection(selectedModel, models)?.name ?? selectedModel
}

function resolveComposerSkillLabel(selectedSkillIDs: string[], skills: SkillInfo[], isLoading: boolean) {
  if (isLoading && skills.length === 0) return "Loading skills..."
  if (selectedSkillIDs.length === 0) return "Skills"
  if (selectedSkillIDs.length === 1) {
    return skills.find((skill) => skill.id === selectedSkillIDs[0])?.name ?? "1 skill"
  }
  return `${selectedSkillIDs.length} skills`
}

function resolveComposerPluginLabel(selectedPluginIDs: string[], plugins: ComposerPluginOption[], isLoading: boolean) {
  if (isLoading && plugins.length === 0) return "Loading plugins..."
  if (selectedPluginIDs.length === 0) return "Plugins"
  if (selectedPluginIDs.length === 1) {
    return plugins.find((plugin) => plugin.value === selectedPluginIDs[0])?.label ?? "1 plugin"
  }
  return `${selectedPluginIDs.length} plugins`
}

function isPluginOwnedMcpServer(
  server: McpServerSummary,
  legacyPluginMcpServerIDs: ReadonlySet<string>,
) {
  if (server.owner?.kind === "plugin") return true
  if (server.owner) return false
  return legacyPluginMcpServerIDs.has(server.id)
}

function describeComposerMcpServer(server: McpServerSummary) {
  if (server.transport === "stdio") {
    return server.command
  }

  if (server.transport === "connector") {
    return server.connectorId
  }

  return server.serverUrl ?? server.connectorId ?? "Remote HTTP MCP"
}

function resolveComposerMcpLabel(selectedServerIDs: string[], servers: McpServerSummary[], isLoading: boolean) {
  if (isLoading && servers.length === 0) return "Loading MCP..."
  if (selectedServerIDs.length === 0) return "MCP"
  if (selectedServerIDs.length === 1) {
    return servers.find((server) => server.id === selectedServerIDs[0])?.name ?? "1 server"
  }
  return `${selectedServerIDs.length} servers`
}

function describeComposerPlugin(plugin: InstalledPlugin, catalogItem: PluginCatalogItem | undefined) {
  const capabilityCounts = [
    plugin.mcpServerIDs.length > 0 ? `${plugin.mcpServerIDs.length} MCP` : null,
    plugin.mcpRequirementIDs.length > 0 ? `${plugin.mcpRequirementIDs.length} built-in MCP` : null,
    plugin.skillIDs.length > 0 ? `${plugin.skillIDs.length} skills` : null,
    plugin.connectorRequirementIDs.length > 0 ? `${plugin.connectorRequirementIDs.length} platform connectors` : null,
    plugin.connectorIDs.length > 0 ? `${plugin.connectorIDs.length} connectors` : null,
  ].filter(Boolean)

  return [catalogItem?.description, capabilityCounts.join(", ")].filter(Boolean).join(" - ") || plugin.pluginID
}

function buildComposerPluginOptions(
  plugins: InstalledPlugin[],
  catalog: PluginCatalogItem[],
): ComposerPluginOption[] {
  const catalogByID = new Map(catalog.map((item) => [item.id, item]))
  return plugins.map((plugin) => {
    const catalogItem = catalogByID.get(plugin.pluginID)
    return {
      value: plugin.pluginID,
      label: catalogItem?.name ?? plugin.pluginID,
      description: describeComposerPlugin(plugin, catalogItem),
      icon: catalogItem?.icon,
      iconUrl: catalogItem?.iconUrl,
    }
  })
}

function resolveComposerReasoningEffortLabel(
  selectedReasoningEffort: ReasoningEffort | null,
  options: ComposerReasoningEffortOption[],
) {
  if (!selectedReasoningEffort) return ""
  return options.find((option) => option.value === selectedReasoningEffort)?.label ?? REASONING_EFFORT_COPY[selectedReasoningEffort].label
}

const projectComposerModelItemsCache = new Map<string, ProviderModel[]>()
const shouldUseComposerResourceCache = import.meta.env.MODE !== "test"

interface ComposerModelsPayload {
  effectiveModel?: ProviderModel | null
  items: ProviderModel[]
  selection?: {
    model?: string
    small_model?: string
    reasoning_effort?: ReasoningEffort
  }
}

interface ComposerSkillsPayload {
  selectedSkillIDs: string[]
  skills: SkillInfo[]
}

interface ComposerMcpPayload {
  selectedMcpServerIDs: string[]
  servers: McpServerSummary[]
}

interface ComposerPluginsPayload {
  pluginMcpServerIDs: string[]
  plugins: ComposerPluginOption[]
  selectedPluginIDs: string[]
}

const projectComposerModelsPayloadCache = new Map<string, ComposerModelsPayload>()
const sessionComposerModelsPayloadCache = new Map<string, ComposerModelsPayload>()
const projectComposerSkillsPayloadCache = new Map<string, ComposerSkillsPayload>()
const projectComposerMcpPayloadCache = new Map<string, ComposerMcpPayload>()
const projectComposerPluginsPayloadCache = new Map<string, ComposerPluginsPayload>()

function getComposerResourceCacheKey(scopeID: string, refreshToken: number) {
  return `${refreshToken}\u0000${scopeID}`
}

function updateCachedProjectComposerModelSelection(
  projectID: string,
  refreshToken: number,
  selection: ComposerModelsPayload["selection"],
) {
  if (!shouldUseComposerResourceCache) return

  const cacheKey = getComposerResourceCacheKey(projectID, refreshToken)
  const cachedPayload = projectComposerModelsPayloadCache.get(cacheKey)
  if (!cachedPayload) return

  projectComposerModelsPayloadCache.set(cacheKey, {
    ...cachedPayload,
    selection,
  })
}

export interface UseProjectComposerOptions {
  attachmentPaths: string[]
  onSessionModelSelectionChange?: (sessionID: string, selection: SessionModelSelection | undefined) => void
  projectID: string | null
  refreshToken?: number
  sessionModelSelection?: SessionModelSelection
  sessionID?: string | null
}

export function useProjectComposer({
  attachmentPaths,
  onSessionModelSelectionChange,
  projectID,
  refreshToken = 0,
  sessionModelSelection,
  sessionID = null,
}: UseProjectComposerOptions) {
  const [models, setModels] = useState<ProviderModel[]>([])
  const [defaultModel, setDefaultModel] = useState<ProviderModel | null>(null)
  const [selectedModel, setSelectedModel] = useState<string | null>(null)
  const [smallModel, setSmallModel] = useState<string | null>(null)
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState<ReasoningEffort | null>(null)
  const [isLoadingModels, setIsLoadingModels] = useState(false)

  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [selectedSkillIDs, setSelectedSkillIDs] = useState<string[]>([])
  const [isLoadingSkills, setIsLoadingSkills] = useState(false)

  const [plugins, setPlugins] = useState<ComposerPluginOption[]>([])
  const [pluginMcpServerIDs, setPluginMcpServerIDs] = useState<string[]>([])
  const [selectedPluginIDs, setSelectedPluginIDs] = useState<string[]>([])
  const [isLoadingPlugins, setIsLoadingPlugins] = useState(false)

  const [mcpServers, setMcpServers] = useState<McpServerSummary[]>([])
  const [selectedMcpServerIDs, setSelectedMcpServerIDs] = useState<string[]>([])
  const [isLoadingMcp, setIsLoadingMcp] = useState(false)

  const modelsRequestRef = useRef(0)
  const modelSelectionRequestRef = useRef(0)
  const skillsRequestRef = useRef(0)
  const skillSelectionRequestRef = useRef(0)
  const pluginsRequestRef = useRef(0)
  const pluginSelectionRequestRef = useRef(0)
  const mcpRequestRef = useRef(0)
  const mcpSelectionRequestRef = useRef(0)
  const pendingModelSelectionRef = useRef<Promise<void> | null>(null)
  const pendingModelSelectionTasksRef = useRef(new Set<Promise<void>>())
  const currentModelScopeRef = useRef({ projectID, sessionID })
  const sessionSelectionModel = sessionModelSelection?.model?.trim() || null
  const sessionSelectionSmallModel = sessionModelSelection?.small_model?.trim() || null
  const sessionSelectionReasoningEffort = sessionModelSelection?.reasoning_effort ?? null

  currentModelScopeRef.current = { projectID, sessionID }

  useLayoutEffect(() => {
    const projectCacheKey = projectID ? getComposerResourceCacheKey(projectID, refreshToken) : null
    const sessionCacheKey = sessionID ? getComposerResourceCacheKey(sessionID, refreshToken) : null
    const cachedPayload = shouldUseComposerResourceCache
      ? (sessionCacheKey ? sessionComposerModelsPayloadCache.get(sessionCacheKey) : null) ??
        (projectCacheKey ? projectComposerModelsPayloadCache.get(projectCacheKey) : null)
      : null

    modelsRequestRef.current += 1
    modelSelectionRequestRef.current += 1
    pendingModelSelectionRef.current = null
    pendingModelSelectionTasksRef.current.clear()

    setModels(cachedPayload?.items ?? (projectID ? projectComposerModelItemsCache.get(projectID) ?? [] : []))
    setDefaultModel(cachedPayload?.effectiveModel ?? null)
    setSelectedModel(sessionID ? sessionSelectionModel : cachedPayload?.selection?.model ?? null)
    setSmallModel(sessionID ? sessionSelectionSmallModel : cachedPayload?.selection?.small_model ?? null)
    setSelectedReasoningEffort(
      sessionID ? sessionSelectionReasoningEffort : cachedPayload?.selection?.reasoning_effort ?? null,
    )
    setIsLoadingModels(Boolean(
      !cachedPayload &&
      projectID &&
      (window.desktop?.getProjectModels || (sessionID && window.desktop?.getSessionModels)),
    ))
  }, [projectID, refreshToken, sessionID])

  useEffect(() => {
    if (!sessionID) return
    setSelectedModel(sessionSelectionModel)
    setSmallModel(sessionSelectionSmallModel)
    setSelectedReasoningEffort(sessionSelectionReasoningEffort)
  }, [sessionID, sessionSelectionModel, sessionSelectionSmallModel, sessionSelectionReasoningEffort])

  useEffect(() => {
    const getProjectModels = window.desktop?.getProjectModels
    const getSessionModels = window.desktop?.getSessionModels
    if (!projectID || (!getProjectModels && !(sessionID && getSessionModels))) {
      setModels([])
      setDefaultModel(null)
      setSelectedModel(null)
      setSmallModel(null)
      setSelectedReasoningEffort(null)
      setIsLoadingModels(false)
      return
    }

    const projectCacheKey = getComposerResourceCacheKey(projectID, refreshToken)
    const sessionCacheKey = sessionID ? getComposerResourceCacheKey(sessionID, refreshToken) : null
    const cachedPayload = shouldUseComposerResourceCache
      ? (sessionCacheKey ? sessionComposerModelsPayloadCache.get(sessionCacheKey) : null) ??
        projectComposerModelsPayloadCache.get(projectCacheKey)
      : null
    if (cachedPayload) {
      setModels(cachedPayload.items)
      setDefaultModel(cachedPayload.effectiveModel ?? null)
      if (sessionID) {
        setSelectedModel(sessionSelectionModel)
        setSmallModel(sessionSelectionSmallModel)
        setSelectedReasoningEffort(sessionSelectionReasoningEffort)
      } else {
        setSelectedModel(cachedPayload.selection?.model ?? null)
        setSmallModel(cachedPayload.selection?.small_model ?? null)
        setSelectedReasoningEffort(cachedPayload.selection?.reasoning_effort ?? null)
      }
      setIsLoadingModels(false)
      return
    }

    const requestID = ++modelsRequestRef.current
    setIsLoadingModels(true)

    const isSessionModelRequest = Boolean(sessionID && getSessionModels)
    const requestProjectID = projectID
    const requestSessionID = sessionID
    const modelRequest =
      isSessionModelRequest && sessionID && getSessionModels
        ? getSessionModels({ sessionID })
        : getProjectModels?.({ projectID })

    if (!modelRequest) {
      setIsLoadingModels(false)
      return
    }

    void modelRequest
      .then((payload) => {
        if (modelsRequestRef.current !== requestID) return
        if (currentModelScopeRef.current.projectID !== requestProjectID) return
        if (currentModelScopeRef.current.sessionID !== requestSessionID) return
        projectComposerModelItemsCache.set(requestProjectID, payload.items)
        if (shouldUseComposerResourceCache) {
          const payloadCacheKey = getComposerResourceCacheKey(
            isSessionModelRequest && requestSessionID ? requestSessionID : requestProjectID,
            refreshToken,
          )
          const cache = isSessionModelRequest && requestSessionID
            ? sessionComposerModelsPayloadCache
            : projectComposerModelsPayloadCache
          cache.set(payloadCacheKey, payload)
        }
        setModels(payload.items)
        setDefaultModel(payload.effectiveModel ?? null)
        if (isSessionModelRequest && requestSessionID) {
          setSelectedModel(payload.selection?.model ?? null)
          setSmallModel(payload.selection?.small_model ?? null)
          setSelectedReasoningEffort(payload.selection?.reasoning_effort ?? null)
          onSessionModelSelectionChange?.(requestSessionID, {
            ...(payload.selection?.model ? { model: payload.selection.model } : {}),
            ...(payload.selection?.small_model ? { small_model: payload.selection.small_model } : {}),
            ...(payload.selection?.reasoning_effort ? { reasoning_effort: payload.selection.reasoning_effort } : {}),
          })
        } else if (requestSessionID) {
          setSelectedModel(sessionSelectionModel)
          setSmallModel(sessionSelectionSmallModel)
          setSelectedReasoningEffort(sessionSelectionReasoningEffort)
        } else {
          setSelectedModel(payload.selection?.model ?? null)
          setSmallModel(payload.selection?.small_model ?? null)
          setSelectedReasoningEffort(payload.selection?.reasoning_effort ?? null)
        }
      })
      .catch((error) => {
        if (modelsRequestRef.current !== requestID) return
        if (currentModelScopeRef.current.projectID !== requestProjectID) return
        if (currentModelScopeRef.current.sessionID !== requestSessionID) return
        console.error("[desktop] refreshProjectComposerModels failed:", error)
        setModels(projectComposerModelItemsCache.get(requestProjectID) ?? [])
        setDefaultModel(null)
      })
      .finally(() => {
        if (modelsRequestRef.current === requestID) {
          setIsLoadingModels(false)
        }
      })
  }, [projectID, refreshToken, sessionID])

  useEffect(() => {
    const getProjectPlugins = window.desktop?.getProjectPlugins
    const getProjectPluginSelection = window.desktop?.getProjectPluginSelection
    const getPluginCatalog = window.desktop?.getPluginCatalog
    if (!projectID || !getProjectPlugins || !getProjectPluginSelection || !getPluginCatalog) {
      setPlugins([])
      setPluginMcpServerIDs([])
      setSelectedPluginIDs([])
      setIsLoadingPlugins(false)
      return
    }

    const cacheKey = getComposerResourceCacheKey(projectID, refreshToken)
    const cachedPayload = shouldUseComposerResourceCache ? projectComposerPluginsPayloadCache.get(cacheKey) : null
    if (cachedPayload) {
      setPlugins(cachedPayload.plugins)
      setPluginMcpServerIDs(cachedPayload.pluginMcpServerIDs ?? [])
      setSelectedPluginIDs(cachedPayload.selectedPluginIDs)
      setIsLoadingPlugins(false)
      return
    }

    const requestID = ++pluginsRequestRef.current
    setIsLoadingPlugins(true)

    void Promise.all([
      getProjectPlugins({ projectID }),
      getProjectPluginSelection({ projectID }),
      getPluginCatalog({ freshness: "cached" }),
    ])
      .then(([nextPlugins, selection, cachedCatalog]) => {
        if (pluginsRequestRef.current !== requestID) return
        const pluginOptions = buildComposerPluginOptions(nextPlugins, cachedCatalog)
        const nextPluginMcpServerIDs = [...new Set(nextPlugins.flatMap((plugin) => plugin.mcpServerIDs))]
        const availablePluginIDs = new Set(pluginOptions.map((plugin) => plugin.value))
        const nextSelectedPluginIDs = selection.pluginIDs.filter((pluginID) => availablePluginIDs.has(pluginID))
        if (shouldUseComposerResourceCache) {
          projectComposerPluginsPayloadCache.set(cacheKey, {
            pluginMcpServerIDs: nextPluginMcpServerIDs,
            plugins: pluginOptions,
            selectedPluginIDs: nextSelectedPluginIDs,
          })
        }
        setPlugins(pluginOptions)
        setPluginMcpServerIDs(nextPluginMcpServerIDs)
        setSelectedPluginIDs(nextSelectedPluginIDs)

        void getPluginCatalog({ freshness: "fresh" })
          .then((freshCatalog) => {
            if (pluginsRequestRef.current !== requestID) return
            if (arePluginCatalogsEqual(cachedCatalog, freshCatalog)) return
            const freshPluginOptions = buildComposerPluginOptions(nextPlugins, freshCatalog)
            const freshAvailablePluginIDs = new Set(freshPluginOptions.map((plugin) => plugin.value))
            setPlugins(freshPluginOptions)
            setSelectedPluginIDs((currentSelectedPluginIDs) => {
              const freshSelectedPluginIDs = currentSelectedPluginIDs.filter((pluginID) =>
                freshAvailablePluginIDs.has(pluginID),
              )
              if (shouldUseComposerResourceCache) {
                projectComposerPluginsPayloadCache.set(cacheKey, {
                  pluginMcpServerIDs: nextPluginMcpServerIDs,
                  plugins: freshPluginOptions,
                  selectedPluginIDs: freshSelectedPluginIDs,
                })
              }
              return freshSelectedPluginIDs
            })
          })
          .catch((error) => {
            if (pluginsRequestRef.current !== requestID) return
            console.error("[desktop] background project plugin catalog refresh failed:", error)
          })
      })
      .catch((error) => {
        if (pluginsRequestRef.current !== requestID) return
        console.error("[desktop] refreshProjectComposerPlugins failed:", error)
        setPlugins([])
        setPluginMcpServerIDs([])
        setSelectedPluginIDs([])
      })
      .finally(() => {
        if (pluginsRequestRef.current === requestID) {
          setIsLoadingPlugins(false)
        }
      })
  }, [projectID, refreshToken])

  useEffect(() => {
    const getProjectSkills = window.desktop?.getProjectSkills
    const getProjectSkillSelection = window.desktop?.getProjectSkillSelection
    if (!projectID || !getProjectSkills || !getProjectSkillSelection) {
      setSkills([])
      setSelectedSkillIDs([])
      setIsLoadingSkills(false)
      return
    }

    const pluginKey = selectedPluginIDs.join("\u0000")
    const cacheKey = getComposerResourceCacheKey(`${projectID}\u0000${pluginKey}`, refreshToken)
    const cachedPayload = shouldUseComposerResourceCache ? projectComposerSkillsPayloadCache.get(cacheKey) : null
    if (cachedPayload) {
      setSkills(cachedPayload.skills)
      setSelectedSkillIDs(cachedPayload.selectedSkillIDs)
      setIsLoadingSkills(false)
      return
    }

    const requestID = ++skillsRequestRef.current
    setIsLoadingSkills(true)

    void Promise.all([getProjectSkills({ projectID }), getProjectSkillSelection({ projectID })])
      .then(([nextSkills, selection]) => {
        if (skillsRequestRef.current !== requestID) return
        const availableSkillIDs = new Set(nextSkills.map((skill) => skill.id))
        const nextSelectedSkillIDs = selection.skillIDs.filter((skillID) => availableSkillIDs.has(skillID))
        if (shouldUseComposerResourceCache) {
          projectComposerSkillsPayloadCache.set(cacheKey, {
            skills: nextSkills,
            selectedSkillIDs: nextSelectedSkillIDs,
          })
        }
        setSkills(nextSkills)
        setSelectedSkillIDs(nextSelectedSkillIDs)
      })
      .catch((error) => {
        if (skillsRequestRef.current !== requestID) return
        console.error("[desktop] refreshProjectComposerSkills failed:", error)
        setSkills([])
        setSelectedSkillIDs([])
      })
      .finally(() => {
        if (skillsRequestRef.current === requestID) {
          setIsLoadingSkills(false)
        }
      })
  }, [projectID, refreshToken, selectedPluginIDs])

  useEffect(() => {
    const getGlobalMcpServers = window.desktop?.getGlobalMcpServers
    const getProjectMcpSelection = window.desktop?.getProjectMcpSelection
    if (!projectID || !getGlobalMcpServers || !getProjectMcpSelection) {
      setMcpServers([])
      setSelectedMcpServerIDs([])
      setIsLoadingMcp(false)
      return
    }

    const cacheKey = getComposerResourceCacheKey(projectID, refreshToken)
    const cachedPayload = shouldUseComposerResourceCache ? projectComposerMcpPayloadCache.get(cacheKey) : null
    if (cachedPayload) {
      setMcpServers(cachedPayload.servers)
      setSelectedMcpServerIDs(cachedPayload.selectedMcpServerIDs)
      setIsLoadingMcp(false)
      return
    }

    const requestID = ++mcpRequestRef.current
    setIsLoadingMcp(true)

    void Promise.all([getGlobalMcpServers(), getProjectMcpSelection({ projectID })])
      .then(([servers, selection]) => {
        if (mcpRequestRef.current !== requestID) return
        const availableServerIDs = new Set(servers.map((server) => server.id))
        const nextSelectedMcpServerIDs = selection.serverIDs.filter((serverID) => availableServerIDs.has(serverID))
        if (shouldUseComposerResourceCache) {
          projectComposerMcpPayloadCache.set(cacheKey, {
            servers,
            selectedMcpServerIDs: nextSelectedMcpServerIDs,
          })
        }
        setMcpServers(servers)
        setSelectedMcpServerIDs(nextSelectedMcpServerIDs)
      })
      .catch((error) => {
        if (mcpRequestRef.current !== requestID) return
        console.error("[desktop] refreshProjectComposerMcp failed:", error)
        setMcpServers([])
        setSelectedMcpServerIDs([])
      })
      .finally(() => {
        if (mcpRequestRef.current === requestID) {
          setIsLoadingMcp(false)
        }
      })
  }, [projectID, refreshToken])

  const modelOptions: ComposerModelOption[] = models
    .filter((model) => model.available)
    .map((model) => ({
      value: toComposerModelValue(model),
      label: toComposerModelLabel(model),
      providerID: model.providerID,
      providerLabel: toComposerModelProviderLabel(model),
    }))
  const effectiveModel = resolveComposerEffectiveModel(selectedModel, models, defaultModel)
  const attachmentCapabilities = getComposerAttachmentCapabilities(effectiveModel)
  const attachmentDisabledReason = getComposerAttachmentDisabledReason(
    effectiveModel,
    attachmentCapabilities,
    isLoadingModels,
  )
  const attachmentError = getComposerAttachmentError(attachmentPaths, effectiveModel, attachmentCapabilities)
  const attachmentButtonTitle =
    attachmentDisabledReason ??
    `Add ${describeComposerAttachmentSupport(attachmentCapabilities) ?? "attachments"}.`
  const skillOptions: ComposerSkillOption[] = skills.map((skill) => ({
    value: skill.id,
    label: skill.name,
    description: skill.description,
  }))
  const legacyPluginMcpServerIDs = new Set(pluginMcpServerIDs)
  const mcpOptions: ComposerMcpOption[] = mcpServers
    .filter((server) => (
      server.enabled
      && !isPluginOwnedMcpServer(server, legacyPluginMcpServerIDs)
    ))
    .map((server) => ({
      value: server.id,
      label: server.name ?? server.id,
      description: describeComposerMcpServer(server),
    }))
  const selectedModelLabel = resolveComposerModelLabel(selectedModel, models, effectiveModel, isLoadingModels)
  const selectedPluginLabel = resolveComposerPluginLabel(selectedPluginIDs, plugins, isLoadingPlugins)
  const selectedSkillLabel = resolveComposerSkillLabel(selectedSkillIDs, skills, isLoadingSkills)
  const selectedMcpLabel = resolveComposerMcpLabel(selectedMcpServerIDs, mcpServers, isLoadingMcp)
  const contextWindow = effectiveModel?.limit.context ?? null
  const reasoningEffortOptions = resolveComposerReasoningEffortOptions(effectiveModel)
  const defaultReasoningEffort = resolveDefaultReasoningEffort(effectiveModel, reasoningEffortOptions)
  const effectiveReasoningEffort = resolveSelectedReasoningEffort(
    selectedReasoningEffort,
    defaultReasoningEffort,
    reasoningEffortOptions,
  )
  const selectedReasoningEffortLabel = resolveComposerReasoningEffortLabel(
    effectiveReasoningEffort,
    reasoningEffortOptions,
  )

  useEffect(() => {
    if (!selectedReasoningEffort) return
    if (reasoningEffortOptions.some((option) => option.value === selectedReasoningEffort)) return
    setSelectedReasoningEffort(null)
  }, [reasoningEffortOptions, selectedReasoningEffort])

  async function awaitPendingModelSelection() {
    while (pendingModelSelectionTasksRef.current.size > 0) {
      await Promise.all([...pendingModelSelectionTasksRef.current]).catch(() => undefined)
    }
  }

  function trackPendingModelSelectionTask(saveTask: Promise<void>) {
    let trackedTask!: Promise<void>
    trackedTask = saveTask.finally(() => {
      pendingModelSelectionTasksRef.current.delete(trackedTask)
      if (pendingModelSelectionRef.current === trackedTask) {
        pendingModelSelectionRef.current = null
      }
    })
    pendingModelSelectionTasksRef.current.add(trackedTask)
    pendingModelSelectionRef.current = trackedTask
    return trackedTask
  }

  async function handleModelChange(value: string | null) {
    const updateProjectModelSelection = window.desktop?.updateProjectModelSelection
    const updateSessionModelSelection = window.desktop?.updateSessionModelSelection
    const targetSessionID = sessionID
    const targetProjectID = projectID
    const previousSelection = selectedModel
    const previousSmallModel = smallModel
    const requestID = ++modelSelectionRequestRef.current
    setSelectedModel(value)

    if (targetSessionID) {
      onSessionModelSelectionChange?.(targetSessionID, {
        ...(value ? { model: value } : {}),
        ...(previousSmallModel ? { small_model: previousSmallModel } : {}),
        ...(selectedReasoningEffort ? { reasoning_effort: selectedReasoningEffort } : {}),
      })
    }

    if (!targetSessionID) {
      if (!targetProjectID || !updateProjectModelSelection) {
        return
      }

      const saveTask = (async () => {
        try {
          const result = await updateProjectModelSelection({
            projectID: targetProjectID,
            model: value,
          })
          if (modelSelectionRequestRef.current !== requestID) return
          if (currentModelScopeRef.current.projectID !== targetProjectID) return
          if (currentModelScopeRef.current.sessionID) return

          setSelectedModel(result.model ?? null)
          setSmallModel(result.small_model ?? null)
          updateCachedProjectComposerModelSelection(targetProjectID, refreshToken, {
            ...(result.model ? { model: result.model } : {}),
            ...(result.small_model ? { small_model: result.small_model } : {}),
            ...(result.reasoning_effort ? { reasoning_effort: result.reasoning_effort } : {}),
          })
        } catch (error) {
          if (modelSelectionRequestRef.current !== requestID) return
          if (currentModelScopeRef.current.projectID !== targetProjectID) return
          if (currentModelScopeRef.current.sessionID) return
          console.error("[desktop] updateProjectComposerModelSelection failed:", error)
          setSelectedModel(previousSelection)
          setSmallModel(previousSmallModel)
          throw error
        }
      })()

      const trackedTask = trackPendingModelSelectionTask(saveTask)

      await trackedTask
      return
    }

    if (!updateSessionModelSelection) {
      return
    }

    const saveTask = (async () => {
      try {
        const result = await updateSessionModelSelection({
          sessionID: targetSessionID,
          model: value,
        })
        if (modelSelectionRequestRef.current !== requestID) return
        if (currentModelScopeRef.current.sessionID !== targetSessionID) return

        setSelectedModel(result.model ?? null)
        setSmallModel(result.small_model ?? null)
        onSessionModelSelectionChange?.(targetSessionID, {
          ...(result.model ? { model: result.model } : {}),
          ...(result.small_model ? { small_model: result.small_model } : {}),
          ...(result.reasoning_effort ? { reasoning_effort: result.reasoning_effort } : {}),
        })
      } catch (error) {
        if (modelSelectionRequestRef.current !== requestID) return
        if (currentModelScopeRef.current.sessionID !== targetSessionID) return
        console.error("[desktop] updateSessionComposerModelSelection failed:", error)
        setSelectedModel(previousSelection)
        setSmallModel(previousSmallModel)
        onSessionModelSelectionChange?.(targetSessionID, {
          ...(previousSelection ? { model: previousSelection } : {}),
          ...(previousSmallModel ? { small_model: previousSmallModel } : {}),
          ...(selectedReasoningEffort ? { reasoning_effort: selectedReasoningEffort } : {}),
        })
        throw error
      }
    })()

    const trackedTask = trackPendingModelSelectionTask(saveTask)

    await trackedTask
  }

  async function handleSkillToggle(value: string) {
    const updateProjectSkillSelection = window.desktop?.updateProjectSkillSelection
    if (!projectID || !updateProjectSkillSelection) {
      return
    }

    const nextSelection = selectedSkillIDs.includes(value)
      ? selectedSkillIDs.filter((item) => item !== value)
      : [...selectedSkillIDs, value]
    setSelectedSkillIDs(nextSelection)

    const requestID = ++skillSelectionRequestRef.current

    try {
      const result = await updateProjectSkillSelection({
        projectID,
        skillIDs: nextSelection,
      })
      if (skillSelectionRequestRef.current !== requestID) return

      const availableSkillIDs = new Set(skills.map((skill) => skill.id))
      const nextSelectedSkillIDs = result.skillIDs.filter((skillID) => availableSkillIDs.has(skillID))
      if (shouldUseComposerResourceCache) {
        const pluginKey = selectedPluginIDs.join("\u0000")
        projectComposerSkillsPayloadCache.set(getComposerResourceCacheKey(`${projectID}\u0000${pluginKey}`, refreshToken), {
          skills,
          selectedSkillIDs: nextSelectedSkillIDs,
        })
      }
      setSelectedSkillIDs(nextSelectedSkillIDs)
    } catch (error) {
      if (skillSelectionRequestRef.current !== requestID) return
      console.error("[desktop] updateProjectComposerSkillSelection failed:", error)
    }
  }

  async function handlePluginToggle(value: string) {
    const updateProjectPluginSelection = window.desktop?.updateProjectPluginSelection
    if (!projectID || !updateProjectPluginSelection) {
      return
    }

    const nextSelection = selectedPluginIDs.includes(value)
      ? selectedPluginIDs.filter((item) => item !== value)
      : [...selectedPluginIDs, value]
    setSelectedPluginIDs(nextSelection)

    const requestID = ++pluginSelectionRequestRef.current

    try {
      const result = await updateProjectPluginSelection({
        projectID,
        pluginIDs: nextSelection,
      })
      if (pluginSelectionRequestRef.current !== requestID) return

      const availablePluginIDs = new Set(plugins.map((plugin) => plugin.value))
      const nextSelectedPluginIDs = result.pluginIDs.filter((pluginID) => availablePluginIDs.has(pluginID))
      if (shouldUseComposerResourceCache) {
        projectComposerPluginsPayloadCache.set(getComposerResourceCacheKey(projectID, refreshToken), {
          pluginMcpServerIDs,
          plugins,
          selectedPluginIDs: nextSelectedPluginIDs,
        })
      }
      setSelectedPluginIDs(nextSelectedPluginIDs)
    } catch (error) {
      if (pluginSelectionRequestRef.current !== requestID) return
      console.error("[desktop] updateProjectComposerPluginSelection failed:", error)
    }
  }

  async function handleMcpToggle(value: string) {
    const updateProjectMcpSelection = window.desktop?.updateProjectMcpSelection
    if (!projectID || !updateProjectMcpSelection) {
      return
    }

    const nextSelection = selectedMcpServerIDs.includes(value)
      ? selectedMcpServerIDs.filter((item) => item !== value)
      : [...selectedMcpServerIDs, value]
    setSelectedMcpServerIDs(nextSelection)

    const requestID = ++mcpSelectionRequestRef.current

    try {
      const result = await updateProjectMcpSelection({
        projectID,
        serverIDs: nextSelection,
      })
      if (mcpSelectionRequestRef.current !== requestID) return

      const availableServerIDs = new Set(mcpServers.map((server) => server.id))
      const nextSelectedMcpServerIDs = result.serverIDs.filter((serverID) => availableServerIDs.has(serverID))
      if (shouldUseComposerResourceCache) {
        projectComposerMcpPayloadCache.set(getComposerResourceCacheKey(projectID, refreshToken), {
          servers: mcpServers,
          selectedMcpServerIDs: nextSelectedMcpServerIDs,
        })
      }
      setSelectedMcpServerIDs(nextSelectedMcpServerIDs)
    } catch (error) {
      if (mcpSelectionRequestRef.current !== requestID) return
      console.error("[desktop] updateProjectComposerMcpSelection failed:", error)
    }
  }

  function handleReasoningEffortChange(value: ReasoningEffort | null) {
    const updateProjectModelSelection = window.desktop?.updateProjectModelSelection
    const updateSessionModelSelection = window.desktop?.updateSessionModelSelection
    const targetProjectID = projectID
    const targetSessionID = sessionID
    const previousReasoningEffort = selectedReasoningEffort
    const requestID = ++modelSelectionRequestRef.current
    setSelectedReasoningEffort(value)

    if (!targetSessionID) {
      if (!targetProjectID || !updateProjectModelSelection) return

      const saveTask = (async () => {
        try {
          const result = await updateProjectModelSelection({
            projectID: targetProjectID,
            reasoning_effort: value,
          })
          if (modelSelectionRequestRef.current !== requestID) return
          if (currentModelScopeRef.current.projectID !== targetProjectID) return
          if (currentModelScopeRef.current.sessionID) return

          setSelectedReasoningEffort(result.reasoning_effort ?? null)
          updateCachedProjectComposerModelSelection(targetProjectID, refreshToken, {
            ...(result.model ? { model: result.model } : {}),
            ...(result.small_model ? { small_model: result.small_model } : {}),
            ...(result.reasoning_effort ? { reasoning_effort: result.reasoning_effort } : {}),
          })
        } catch (error) {
          if (modelSelectionRequestRef.current !== requestID) return
          if (currentModelScopeRef.current.projectID !== targetProjectID) return
          if (currentModelScopeRef.current.sessionID) return
          console.error("[desktop] updateProjectComposerReasoningEffort failed:", error)
          setSelectedReasoningEffort(previousReasoningEffort)
          throw error
        }
      })()

      void trackPendingModelSelectionTask(saveTask).catch(() => undefined)
      return
    }

    if (!updateSessionModelSelection) return

    onSessionModelSelectionChange?.(targetSessionID, {
      ...(selectedModel ? { model: selectedModel } : {}),
      ...(smallModel ? { small_model: smallModel } : {}),
      ...(value ? { reasoning_effort: value } : {}),
    })

    const saveTask = (async () => {
      try {
        const result = await updateSessionModelSelection({
          sessionID: targetSessionID,
          reasoning_effort: value,
        })
        if (modelSelectionRequestRef.current !== requestID) return
        if (currentModelScopeRef.current.sessionID !== targetSessionID) return

        setSelectedReasoningEffort(result.reasoning_effort ?? null)
        onSessionModelSelectionChange?.(targetSessionID, {
          ...(result.model ? { model: result.model } : {}),
          ...(result.small_model ? { small_model: result.small_model } : {}),
          ...(result.reasoning_effort ? { reasoning_effort: result.reasoning_effort } : {}),
        })
      } catch (error) {
        if (modelSelectionRequestRef.current !== requestID) return
        if (currentModelScopeRef.current.sessionID !== targetSessionID) return
        console.error("[desktop] updateSessionComposerReasoningEffort failed:", error)
        setSelectedReasoningEffort(previousReasoningEffort)
        onSessionModelSelectionChange?.(targetSessionID, {
          ...(selectedModel ? { model: selectedModel } : {}),
          ...(smallModel ? { small_model: smallModel } : {}),
          ...(previousReasoningEffort ? { reasoning_effort: previousReasoningEffort } : {}),
        })
        throw error
      }
    })()

    void trackPendingModelSelectionTask(saveTask).catch(() => undefined)
  }

  return {
    attachmentCapabilities,
    attachmentButtonTitle,
    attachmentDisabledReason,
    attachmentError,
    awaitPendingModelSelection,
    contextWindow,
    handleMcpToggle,
    handleModelChange,
    handlePluginToggle,
    handleReasoningEffortChange,
    handleSkillToggle,
    mcpOptions,
    modelOptions,
    pluginOptions: plugins,
    reasoningEffortOptions,
    selectedMcpLabel,
    selectedMcpServerIDs,
    selectedModel,
    selectedModelLabel,
    selectedPluginIDs,
    selectedPluginLabel,
    selectedReasoningEffort: effectiveReasoningEffort,
    selectedReasoningEffortLabel,
    selectedSkillIDs,
    selectedSkillLabel,
    skillOptions,
    unsupportedAttachmentPaths: attachmentPaths.filter(
      (path) => !isComposerAttachmentSupported(path, attachmentCapabilities),
    ),
  }
}
