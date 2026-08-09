import type { JSONValue } from "@ai-sdk/provider"
import { jsonSchema, tool, type ToolSet } from "ai"
import * as Agent from "#agent/agent.ts"
import * as Config from "#config/config.ts"
import { Flag } from "#flag/flag.ts"
import { Instance } from "#project/instance.ts"
import type * as Provider from "#provider/provider.ts"
import type * as Message from "#session/core/message.ts"
import {
  createToolSearchIndex,
  type ToolModuleSearchDefinition,
  type ToolSearchCandidate,
  type ToolSearchDefinition,
} from "#session/core/tool-search.ts"
import * as Tool from "#tool/tool.ts"
import {
  createToolExecution,
  getToolAccessFailure,
  readOnlyToolsOnlyForSession,
} from "#tool/execution.ts"
import * as ToolRegistry from "#tool/registry.ts"
import * as ToolModule from "#tool/module.ts"
import {
  TOOL_SEARCH_ID,
  TOOL_SEARCH_MODEL_NAME,
  ToolSearchParameters,
} from "#tool/tool-search.ts"
import * as Log from "#util/log.ts"

const log = Log.create({ service: "session.resolve-tools" })
const PROVIDER_SAFE_TOOL_NAME_PATTERN = /^[a-z0-9_]+$/

export type ToolExposure = "direct" | "deferred"

export type ResolvedToolEntry = {
  item: Tool.ToolInfo
  moduleID: string
  modelName: string
  exposure: ToolExposure
  discovered: boolean
}

export type ResolvedToolPlan = {
  registryTools: ToolSet
  activeToolNames: string[]
  activeToolModuleIDs: string[]
  visibleTools: ToolSet
  toolSources: Record<string, Tool.ToolSource>
  modules: ToolModule.ToolModuleCatalogEntry[]
  entries: ResolvedToolEntry[]
}

export type ResolveToolsInput = {
  agent: Agent.AgentInfo
  sessionID: string
  turnID?: string
  messageID: string
  abort: AbortSignal
  model?: Provider.Model
  messages?: Message.WithParts[]
  turnUserMessageID?: string
  turnMcpServerIDs?: string[]
  turnToolModuleIDs?: string[]
  discoveredToolNames?: Iterable<string>
  discoveredToolModuleIDs?: Iterable<string>
  toolSearchEnabled?: boolean
}

function isProviderSafeToolName(name: string) {
  return PROVIDER_SAFE_TOOL_NAME_PATTERN.test(name)
}

function uniqueStrings(values: Iterable<string> | undefined) {
  return [...new Set(
    [...(values ?? [])]
      .map((value) => value.trim())
      .filter(Boolean),
  )]
}

function readToolSearchMetadata(part: Message.ToolPart) {
  if (part.state.status !== "completed") return undefined
  const metadata = part.state.metadata
  if (metadata.kind !== "tool-search") return undefined
  return {
    toolNames: Array.isArray(metadata.loadedToolNames)
      ? metadata.loadedToolNames.filter((value): value is string => typeof value === "string")
      : [],
    toolModuleIDs: Array.isArray(metadata.loadedToolModuleIDs)
      ? metadata.loadedToolModuleIDs.filter((value): value is string => typeof value === "string")
      : [],
  }
}

export function readTurnDiscoveredToolNames(
  messages: Message.WithParts[] | undefined,
  turnUserMessageID: string | undefined,
) {
  const result = new Set<string>()
  if (!messages || !turnUserMessageID) return result

  let withinTurn = false
  for (const message of messages) {
    if (message.info.id === turnUserMessageID && message.info.role === "user") {
      withinTurn = true
      continue
    }
    if (!withinTurn) continue
    if (message.info.role === "user" && !message.info.internal) break
    if (message.info.role !== "assistant") continue

    for (const part of message.parts) {
      if (part.type !== "tool") continue
      const modelName = Tool.toModelToolName(part.tool)
      // Accept the old model-facing name so unfinished or persisted turns from
      // before the OpenAI reserved-name fix can still restore discoveries.
      if (modelName !== TOOL_SEARCH_MODEL_NAME && modelName !== TOOL_SEARCH_ID) continue
      for (const toolName of readToolSearchMetadata(part)?.toolNames ?? []) {
        result.add(Tool.toModelToolName(toolName))
      }
    }
  }

  return result
}

export function readTurnDiscoveredToolModuleIDs(
  messages: Message.WithParts[] | undefined,
  turnUserMessageID: string | undefined,
) {
  const result = new Set<string>()
  if (!messages || !turnUserMessageID) return result

  let withinTurn = false
  for (const message of messages) {
    if (message.info.id === turnUserMessageID && message.info.role === "user") {
      withinTurn = true
      continue
    }
    if (!withinTurn) continue
    if (message.info.role === "user" && !message.info.internal) break
    if (message.info.role !== "assistant") continue

    for (const part of message.parts) {
      if (part.type !== "tool") continue
      const modelName = Tool.toModelToolName(part.tool)
      if (modelName !== TOOL_SEARCH_MODEL_NAME && modelName !== TOOL_SEARCH_ID) continue
      for (const moduleID of readToolSearchMetadata(part)?.toolModuleIDs ?? []) {
        const normalizedID = moduleID.trim()
        if (normalizedID) result.add(normalizedID)
      }
    }
  }

  return result
}

const TOOL_SEARCH_DESCRIPTION =
  "Search and load optional Anybox capability modules or deferred tools needed for the current request. Loaded tools are available on the next model call in this user turn only."
const MAX_MODULES_PER_SEARCH = 3

function createSearchTool(definitions: ToolSearchCandidate[]) {
  const index = createToolSearchIndex(definitions)
  return tool({
    title: "Tool Search",
    description: TOOL_SEARCH_DESCRIPTION,
    inputSchema: ToolSearchParameters,
    execute: async ({ query, limit }) => {
      const matches = index.search(query, limit)
      const tools = matches.filter((match): match is ToolSearchDefinition => match.kind !== "module")
      const modules = matches
        .filter((match): match is ToolModuleSearchDefinition => match.kind === "module")
        .slice(0, MAX_MODULES_PER_SEARCH)
        .map((match) => ({
          id: match.id,
          title: match.title,
          description: match.description,
        }))
      const data = { tools, modules }
      return {
        title: "Tool Search",
        text: JSON.stringify(data),
        metadata: {
          kind: "tool-search",
          loadedToolNames: tools.map((match) => match.name),
          loadedToolModuleIDs: modules.map((match) => match.id),
        },
        data,
      } satisfies Tool.ToolOutput<Record<string, unknown>, typeof data>
    },
    toModelOutput: async ({ output }) => ({
      type: "json",
      value: (output.data ?? { tools: [], modules: [] }) as unknown as JSONValue,
    }),
  })
}

async function isToolSearchEnabled(input: ResolveToolsInput) {
  if (Flag.ANYBOX_DISABLE_TOOL_SEARCH) return false
  if (typeof input.toolSearchEnabled === "boolean") return input.toolSearchEnabled

  const projectID = Instance.project.id
  const [projectConfig, globalConfig] = await Promise.all([
    Config.get(projectID),
    projectID === Config.GLOBAL_CONFIG_ID
      ? Promise.resolve(undefined)
      : Config.get(Config.GLOBAL_CONFIG_ID),
  ])
  return (projectConfig.experimental?.toolSearch ?? globalConfig?.experimental?.toolSearch) !== false
}

export async function resolveToolPlan(input: ResolveToolsInput): Promise<ResolvedToolPlan> {
  const [
    inventory,
    globalToolSelection,
    persistentMcpServers,
    toolSearchFeatureEnabled,
  ] = await Promise.all([
    ToolRegistry.inventory(input.abort),
    Config.getToolSelection(Config.GLOBAL_CONFIG_ID),
    Config.resolveProjectMcpServers(Instance.project.id),
    isToolSearchEnabled(input),
  ])
  const builtinRegistry = inventory.builtin
  const builtinToolIDs = new Set(builtinRegistry.map((item) => item.id))
  const persistentMcpServerIDs = new Set(persistentMcpServers.map((server) => server.id))
  const turnMcpServerIDs = new Set(uniqueStrings(input.turnMcpServerIDs))
  const discoveredToolNames = readTurnDiscoveredToolNames(input.messages, input.turnUserMessageID)
  for (const name of input.discoveredToolNames ?? []) {
    discoveredToolNames.add(Tool.toModelToolName(name))
  }

  const requestedToolModuleIDs = uniqueStrings(input.turnToolModuleIDs)
  const discoveredToolModuleIDs = readTurnDiscoveredToolModuleIDs(
    input.messages,
    input.turnUserMessageID,
  )
  for (const moduleID of input.discoveredToolModuleIDs ?? []) {
    const normalizedID = moduleID.trim()
    if (normalizedID) discoveredToolModuleIDs.add(normalizedID)
  }
  const requestedOrDiscoveredToolModuleIDs = uniqueStrings([
    ...requestedToolModuleIDs,
    ...discoveredToolModuleIDs,
  ])

  const moduleCatalog = await ToolModule.catalog({
    tools: inventory.all,
    activatedModuleIDs: requestedOrDiscoveredToolModuleIDs,
    persistentMcpServerIDs,
    turnMcpServerIDs,
  })
  const moduleByID = new Map(
    moduleCatalog.entries.map((entry) => [entry.descriptor.id, entry]),
  )
  for (const moduleID of requestedOrDiscoveredToolModuleIDs) {
    if (!moduleByID.has(moduleID)) {
      log.warn("turn-scoped tool module is unavailable and will be ignored", {
        sessionID: input.sessionID,
        moduleID,
      })
    }
  }
  for (const failure of moduleCatalog.failures) {
    log.warn("failed to load tool module", {
      sessionID: input.sessionID,
      moduleID: failure.moduleID,
      error: failure.error instanceof Error ? failure.error.message : String(failure.error),
    })
  }

  const registry = moduleCatalog.entries.flatMap((entry) => entry.tools)
  ToolRegistry.assertUniqueToolNames(registry)

  const readOnlyToolsOnly = readOnlyToolsOnlyForSession(input.agent, input.sessionID, input.turnID)
  const accessFailureFor = (item: Tool.ToolInfo) => getToolAccessFailure({
    item,
    agent: input.agent,
    model: input.model,
    builtinToolIDs,
    globalToolSelection,
    readOnlyToolsOnly,
  })
  const activeToolModuleIDs = moduleCatalog.entries
    .filter((entry) =>
      entry.active &&
      entry.turnActivated &&
      entry.tools.some((item) => !accessFailureFor(item)),
    )
    .map((entry) => entry.descriptor.id)

  const toolSearchCatalogItem = builtinRegistry.find((item) => item.id === TOOL_SEARCH_ID)
  const toolSearchAccessFailure = toolSearchCatalogItem
    ? accessFailureFor(toolSearchCatalogItem)
    : `Built-in tool "${TOOL_SEARCH_ID}" is not registered.`
  const progressiveDisclosureEnabled =
    toolSearchFeatureEnabled &&
    Boolean(toolSearchCatalogItem) &&
    !toolSearchAccessFailure
  const registryTools: ToolSet = {}
  const entries: ResolvedToolEntry[] = []
  const searchDefinitions: ToolSearchCandidate[] = moduleCatalog.entries
    .filter((entry) =>
      !entry.active &&
      entry.descriptor.activation.discovery === "module" &&
      !requestedOrDiscoveredToolModuleIDs.includes(entry.descriptor.id) &&
      // Lazily loaded native modules have no tool definitions until they are
      // activated. Keep their descriptor searchable without forcing a load;
      // model requirements are enforced as soon as their tools materialize.
      (entry.tools.length === 0 || entry.tools.some((item) => !accessFailureFor(item))),
    )
    .map(({ descriptor }): ToolModuleSearchDefinition => ({
      kind: "module",
      id: descriptor.id,
      name: descriptor.id,
      title: descriptor.title,
      description: descriptor.description,
      keywords: descriptor.keywords,
      source: ToolModule.sourceForDescriptor(descriptor),
    }))
  const registeredMcpServerIDs = new Set<string>()

  for (const moduleEntry of moduleCatalog.entries) {
    const descriptor = moduleEntry.descriptor
    if (descriptor.provider.kind === "mcp" && moduleEntry.tools.length > 0) {
      registeredMcpServerIDs.add(descriptor.provider.id)
    }

    const moduleExposure: ToolExposure | "hidden" =
      !progressiveDisclosureEnabled && moduleEntry.exposure === "deferred"
        ? "direct"
        : moduleEntry.exposure
    if (moduleExposure === "hidden") continue

    for (const item of moduleEntry.tools) {
      // The search tool is statically cataloged under TOOL_SEARCH_ID, but its
      // executable model alias is bound to this Turn's deferred candidates below.
      if (item.id === TOOL_SEARCH_ID) continue

      if (accessFailureFor(item)) {
        continue
      }

      const modelName = Tool.toModelToolName(item.id)
      if (!isProviderSafeToolName(modelName)) {
        throw new Error(`Tool "${item.id}" does not expose a provider-safe snake_case name.`)
      }

      const exposure: ToolExposure = moduleExposure
      const discovered = exposure === "deferred" && discoveredToolNames.has(modelName)

      entries.push({
        item,
        moduleID: descriptor.id,
        modelName,
        exposure,
        discovered,
      })

      if (
        descriptor.activation.discovery === "tool" &&
        exposure === "deferred" &&
        !discovered
      ) {
        searchDefinitions.push({
          kind: "tool",
          id: item.id,
          name: modelName,
          title: item.title,
          description: item.description ?? item.title ?? item.id,
          inputSchema: item.inputSchema ?? {
            type: "object",
            additionalProperties: true,
          },
          source: item.source!,
        })
        continue
      }

      let execution: Awaited<ReturnType<typeof createToolExecution>>
      try {
        execution = await createToolExecution({
          item,
          agent: input.agent,
          model: input.model,
          sessionID: input.sessionID,
          turnID: input.turnID,
          messageID: input.messageID,
          abort: input.abort,
        })
      } catch (error) {
        if (descriptor.failureMode === "throw") throw error
        log.warn("failed to initialize visible tool", {
          toolID: item.id,
          moduleID: descriptor.id,
          providerKind: descriptor.provider.kind,
          providerID: descriptor.provider.id,
          error: error instanceof Error ? error.message : String(error),
        })
        continue
      }

      if (registryTools[modelName]) {
        throw new Error(`Duplicate resolved tool name "${modelName}".`)
      }

      registryTools[modelName] = tool<any, Tool.ToolOutput, Record<string, unknown>>({
        title: execution.title,
        description: execution.description,
        inputSchema: item.inputSchema
          ? jsonSchema(item.inputSchema)
          : execution.parameters,
        needsApproval: async (args, options) => {
          return execution.needsApproval(args, options.toolCallId)
        },
        execute: async (args, options) => {
          return execution.execute(args, { toolCallID: options.toolCallId })
        },
        toModelOutput: async ({ output }) => {
          return execution.toModelOutput(output as Tool.ToolOutput)
        },
      })
    }
  }

  for (const serverID of turnMcpServerIDs) {
    if (registeredMcpServerIDs.has(serverID)) continue
    log.warn("turn-scoped MCP server is unavailable and will be ignored", {
      sessionID: input.sessionID,
      serverID,
    })
  }

  if (
    progressiveDisclosureEnabled &&
    toolSearchCatalogItem &&
    searchDefinitions.length > 0
  ) {
    registryTools[TOOL_SEARCH_MODEL_NAME] = createSearchTool(searchDefinitions)
    entries.push({
      item: toolSearchCatalogItem,
      moduleID: toolSearchCatalogItem.source?.moduleID ?? ToolModule.PROGRESSIVE_DISCLOSURE_TOOL_MODULE_ID,
      modelName: TOOL_SEARCH_MODEL_NAME,
      exposure: "direct",
      discovered: false,
    })
  }

  const activeToolNames = entries
    .filter((entry) =>
      (entry.exposure === "direct" || entry.discovered) &&
      Boolean(registryTools[entry.modelName]),
    )
    .map((entry) => entry.modelName)

  const visibleTools: ToolSet = {}
  const toolSources: Record<string, Tool.ToolSource> = {}
  for (const name of activeToolNames) {
    const resolved = registryTools[name]
    if (resolved) visibleTools[name] = resolved
    const source = entries.find((entry) => entry.modelName === name)?.item.source
    if (source) toolSources[name] = source
  }

  return {
    registryTools,
    activeToolNames,
    activeToolModuleIDs,
    visibleTools,
    toolSources,
    modules: moduleCatalog.entries,
    entries,
  }
}

// Compatibility helper for callers that need the executable runtime registry.
export async function resolveTools(input: ResolveToolsInput): Promise<ToolSet> {
  return (await resolveToolPlan(input)).registryTools
}
