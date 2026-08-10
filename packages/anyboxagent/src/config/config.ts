import z from "zod"
import { mergeDeep } from "remeda"
import * as Log from "#util/log.ts"
import * as db from "#database/Sqlite.ts"
import { toCreateTableSQL, withPrimaryKey, zodObjectToColumnDefs } from "#database/parser.ts"
import { ensureLegacySessionCleanup } from "#database/legacy-session-cleanup.ts"
import { DevModel, DevProvider } from "#provider/modelsdev.ts"
import { ReasoningEffortSchema } from "@anybox/shared"

const log = Log.create({ service: "config" })
export const GLOBAL_CONFIG_ID = "__global__"

export const PermissionMode = z.enum(["default", "full_access"]).meta({
  ref: "PermissionMode",
})
export type PermissionMode = z.infer<typeof PermissionMode>
export const DEFAULT_PERMISSION_MODE: PermissionMode = "default"

export const Provider = DevProvider.partial()
  .extend({
    whitelist: z.array(z.string()).optional(),
    blacklist: z.array(z.string()).optional(),
    models: z
      .record(
        z.string(),
        DevModel.partial().extend({
          variants: z
            .record(
              z.string(),
              z
                .object({
                  disabled: z.boolean().optional().describe("Disable this variant for the model"),
                })
                .catchall(z.any()),
            )
            .optional()
            .describe("Variant-specific configuration"),
        }),
      )
      .optional(),
    options: z
      .object({
        apiKey: z.string().optional(),
        baseURL: z.string().optional(),
        enterpriseUrl: z.string().optional().describe("GitHub Enterprise URL for copilot authentication"),
        setCacheKey: z.boolean().optional().describe("Enable promptCacheKey for this provider (default false)"),
        timeout: z
          .union([
            z
              .number()
              .int()
              .positive()
              .describe(
                "Timeout in milliseconds for requests to this provider. Default is 300000 (5 minutes). Set to false to disable timeout.",
              ),
            z.literal(false).describe("Disable timeout for this provider entirely."),
          ])
          .optional()
          .describe(
            "Timeout in milliseconds for requests to this provider. Default is 300000 (5 minutes). Set to false to disable timeout.",
          ),
      })
      .catchall(z.any())
      .optional(),
  })
  .strict()
  .meta({
    ref: "ProviderConfig",
  })
export type Provider = z.infer<typeof Provider>

const ProviderMapField = z
  .record(z.string(), Provider)
  .optional()
  .describe("Custom provider configurations and model overrides")

  
const ModelField = z.string().describe("Model to use in the format of provider/model, eg anthropic/claude-2")

const SmallModelField = z
  .string()
  .describe("Small model to use for tasks like title generation in the format of provider/model")

const ImageModelField = z
  .string()
  .describe("Image generation model to use in the format of provider/model")

export const ImageGenerationSettings = z
  .object({
    default_size: z
      .string()
      .regex(/^\d+x\d+$/)
      .optional()
      .describe("Default image generation size, for example 1024x1024"),
    default_count: z
      .number()
      .int()
      .min(1)
      .max(4)
      .optional()
      .describe("Default number of images to generate"),
  })
  .strict()
  .meta({
    ref: "ImageGenerationSettings",
  })
export type ImageGenerationSettings = z.infer<typeof ImageGenerationSettings>

const EnabledProvidersField = z
  .array(z.string())
  .optional()
  .describe("When set, ONLY these providers will be enabled. All other providers will be ignored")

const DisabledProvidersField = z.array(z.string()).optional().describe("Disable providers that are loaded automatically")

const ProviderConfigFields = {
  disabled_providers: DisabledProvidersField,
  enabled_providers: EnabledProvidersField,
  model: ModelField.optional(),
  small_model: SmallModelField.optional(),
  image_model: ImageModelField.optional(),
  provider: ProviderMapField,
}

const ModelSelectionFields = {
  model: ModelField.nullable().optional(),
  small_model: SmallModelField.nullable().optional(),
  image_model: ImageModelField.nullable().optional(),
  image_generation: ImageGenerationSettings.nullable().optional(),
  reasoning_effort: ReasoningEffortSchema.nullable().optional(),
}

const SelectedMcpServersField = z
  .array(z.string())
  .optional()
  .describe("Project-scoped selected global MCP server ids")

const SelectedSkillsField = z
  .array(z.string())
  .optional()
  .describe("Project-scoped selected skill ids")

const SelectedPluginsField = z
  .array(z.string())
  .optional()
  .describe("Project-scoped selected installed plugin ids")

const PromptOverridesField = z
  .record(z.string(), z.string())
  .optional()
  .describe("Prompt preset overrides keyed by preset id")

export const CustomPromptPreset = z
  .object({
    label: z.string().min(1),
    content: z.string(),
    description: z.string().optional(),
  })
  .strict()
  .meta({
    ref: "CustomPromptPreset",
  })
export type CustomPromptPreset = z.infer<typeof CustomPromptPreset>

const CustomPromptPresetsField = z
  .record(z.string(), CustomPromptPreset)
  .optional()
  .describe("Custom prompt preset definitions keyed by preset id")

const SelectedSystemPromptPresetField = z
  .string()
  .optional()
  .describe("Selected preset id for the runtime system prompt")

const SelectedPlanModePromptPresetField = z
  .string()
  .optional()
  .describe("Selected preset id for the runtime plan-mode prompt")

const SelectedGitCommitPromptPresetField = z
  .string()
  .optional()
  .describe("Selected preset id for the Git commit message prompt")

export const McpServerTransport = z.enum(["stdio", "remote", "connector"]).meta({
  ref: "McpServerTransport",
})
export type McpServerTransport = z.infer<typeof McpServerTransport>

export const McpRemoteProvider = z.literal("openai").meta({
  ref: "McpRemoteProvider",
})
export type McpRemoteProvider = z.infer<typeof McpRemoteProvider>

export const McpAllowedTools = z
  .union([
    z.array(z.string()),
    z.object({
      readOnly: z.boolean().optional(),
      toolNames: z.array(z.string()).optional(),
    }),
  ])
  .optional()
  .meta({
    ref: "McpAllowedTools",
  })
export type McpAllowedTools = z.infer<typeof McpAllowedTools>

export const McpToolPolicyValue = z.enum(["disabled", "ask", "auto"]).meta({
  ref: "McpToolPolicyValue",
})
export type McpToolPolicyValue = z.infer<typeof McpToolPolicyValue>

export const McpToolPolicy = z
  .object({
    policy: McpToolPolicyValue,
  })
  .strict()
  .meta({
    ref: "McpToolPolicy",
  })
export type McpToolPolicy = z.infer<typeof McpToolPolicy>

export const McpToolPolicies = z
  .record(z.string(), McpToolPolicy)
  .optional()
  .meta({
    ref: "McpToolPolicies",
  })
export type McpToolPolicies = z.infer<typeof McpToolPolicies>

export const McpRequireApproval = z
  .union([
    z.enum(["always", "never"]),
    z.object({
      never: z
        .object({
          toolNames: z.array(z.string()).optional(),
        })
        .optional(),
    }),
  ])
  .optional()
  .meta({
    ref: "McpRequireApproval",
  })
export type McpRequireApproval = z.infer<typeof McpRequireApproval>

export const McpServerOwner = z
  .discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("connector"),
        connectorId: z.string().min(1),
        runtimeID: z.string().min(1),
      })
      .strict(),
    z
      .object({
        kind: z.literal("plugin"),
        pluginID: z.string().min(1),
        bindingID: z.string().min(1),
      })
      .strict(),
    z
      .object({
        kind: z.literal("anybox"),
        bindingID: z.string().min(1),
      })
      .strict(),
    z
      .object({
        kind: z.literal("user"),
      })
      .strict(),
  ])
  .meta({
    ref: "McpServerOwner",
  })
export type McpServerOwner = z.infer<typeof McpServerOwner>

const McpServerBaseFields = {
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  timeoutMs: z.number().int().positive().optional(),
  toolPolicies: McpToolPolicies,
  owner: McpServerOwner.optional(),
} as const

export const McpStdioServerConfig = z
  .object({
    ...McpServerBaseFields,
    transport: z.literal("stdio").optional(),
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    cwd: z.string().min(1).optional(),
  })
  .strict()
  .meta({
    ref: "McpStdioServerConfig",
  })
export type McpStdioServerConfig = z.infer<typeof McpStdioServerConfig>

export const McpRemoteServerConfig = z
  .object({
    ...McpServerBaseFields,
    transport: z.literal("remote"),
    provider: McpRemoteProvider.optional(),
    serverUrl: z.string().min(1).optional(),
    connectorId: z.string().min(1).optional(),
    connectorRuntimeId: z.string().min(1).optional(),
    authorization: z.string().min(1).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    serverDescription: z.string().min(1).optional(),
    allowedTools: McpAllowedTools,
    toolPolicies: McpToolPolicies,
    requireApproval: McpRequireApproval,
  })
  .strict()
  .refine((value) => Boolean(value.serverUrl || value.connectorId), {
    message: "Remote MCP servers require either serverUrl or connectorId.",
    path: ["serverUrl"],
  })
  .meta({
    ref: "McpRemoteServerConfig",
  })
export type McpRemoteServerConfig = z.infer<typeof McpRemoteServerConfig>

export const McpConnectorServerConfig = z
  .object({
    ...McpServerBaseFields,
    transport: z.literal("connector"),
    connectorId: z.string().min(1),
    connectorRuntimeId: z.string().min(1).optional(),
    provider: McpRemoteProvider.optional(),
    serverDescription: z.string().min(1).optional(),
    allowedTools: McpAllowedTools,
    requireApproval: McpRequireApproval,
  })
  .strict()
  .meta({
    ref: "McpConnectorServerConfig",
  })
export type McpConnectorServerConfig = z.infer<typeof McpConnectorServerConfig>

export const McpServerConfig = z.union([McpStdioServerConfig, McpRemoteServerConfig, McpConnectorServerConfig]).meta({
  ref: "McpServerConfig",
})
export type McpServerConfig = z.infer<typeof McpServerConfig>

export const McpStdioServerInput = McpStdioServerConfig.omit({
  id: true,
  owner: true,
}).meta({
  ref: "McpStdioServerInput",
})
export type McpStdioServerInput = z.infer<typeof McpStdioServerInput>

export const McpRemoteServerInput = z
  .object({
    name: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
    timeoutMs: z.number().int().positive().optional(),
    transport: z.literal("remote"),
    provider: McpRemoteProvider.optional(),
    serverUrl: z.string().min(1).optional(),
    connectorId: z.string().min(1).optional(),
    connectorRuntimeId: z.string().min(1).optional(),
    authorization: z.string().min(1).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    serverDescription: z.string().min(1).optional(),
    allowedTools: McpAllowedTools,
    toolPolicies: McpToolPolicies,
    requireApproval: McpRequireApproval,
  })
  .strict()
  .refine((value) => Boolean(value.serverUrl || value.connectorId), {
    message: "Remote MCP servers require either serverUrl or connectorId.",
    path: ["serverUrl"],
  })
  .meta({
    ref: "McpRemoteServerInput",
  })
export type McpRemoteServerInput = z.infer<typeof McpRemoteServerInput>

export const McpConnectorServerInput = McpConnectorServerConfig.omit({
  id: true,
  owner: true,
}).meta({
  ref: "McpConnectorServerInput",
})
export type McpConnectorServerInput = z.infer<typeof McpConnectorServerInput>

export const McpServerInput = z.union([McpStdioServerInput, McpRemoteServerInput, McpConnectorServerInput]).meta({
  ref: "McpServerInput",
})
export type McpServerInput = z.infer<typeof McpServerInput>

export const McpStdioServerSummary = McpStdioServerConfig.extend({
  transport: z.literal("stdio"),
  enabled: z.boolean(),
}).meta({
  ref: "McpStdioServerSummary",
})
export type McpStdioServerSummary = z.infer<typeof McpStdioServerSummary>

export const McpRemoteServerSummary = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).optional(),
    enabled: z.boolean(),
    timeoutMs: z.number().int().positive().optional(),
    transport: z.literal("remote"),
    provider: McpRemoteProvider.optional(),
    serverUrl: z.string().min(1).optional(),
    connectorId: z.string().min(1).optional(),
    connectorRuntimeId: z.string().min(1).optional(),
    authorization: z.string().min(1).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    serverDescription: z.string().min(1).optional(),
    allowedTools: McpAllowedTools,
    toolPolicies: McpToolPolicies,
    requireApproval: McpRequireApproval,
    owner: McpServerOwner.optional(),
  })
  .strict()
  .refine((value) => Boolean(value.serverUrl || value.connectorId), {
    message: "Remote MCP servers require either serverUrl or connectorId.",
    path: ["serverUrl"],
  })
  .meta({
    ref: "McpRemoteServerSummary",
  })
export type McpRemoteServerSummary = z.infer<typeof McpRemoteServerSummary>

export const McpConnectorServerSummary = McpConnectorServerConfig.extend({
  enabled: z.boolean(),
}).meta({
  ref: "McpConnectorServerSummary",
})
export type McpConnectorServerSummary = z.infer<typeof McpConnectorServerSummary>

export const McpServerSummary = z.union([McpStdioServerSummary, McpRemoteServerSummary, McpConnectorServerSummary]).meta({
  ref: "McpServerSummary",
})
export type McpServerSummary = z.infer<typeof McpServerSummary>

const McpConfigField = z
  .object({
    servers: z.record(z.string(), McpServerConfig).optional(),
  })
  .strict()
  .optional()
  .describe("MCP server definitions")

export const Info = z
  .object({
    $schema: z.string().optional().describe("JSON schema reference for configuration validation"),
    logLevel: Log.Level.optional().describe("Log level"),
    watcher: z
      .object({
        ignore: z.array(z.string()).optional(),
      })
      .optional(),
    plugin: z.string().array().optional(),
    snapshot: z.boolean().optional(),
    share: z
      .enum(["manual", "auto", "disabled"])
      .optional()
      .describe(
        "Control sharing behavior:'manual' allows manual sharing via commands, 'auto' enables automatic sharing, 'disabled' disables all sharing",
      ),
    autoshare: z
      .boolean()
      .optional()
      .describe("@deprecated Use 'share' field instead. Share newly created sessions automatically"),
    autoupdate: z
      .union([z.boolean(), z.literal("notify")])
      .optional()
      .describe(
        "Automatically update to the latest version. Set to true to auto-update, false to disable, or 'notify' to show update notifications",
      ),
    ...ProviderConfigFields,
    image_generation: ImageGenerationSettings.optional(),
    reasoning_effort: ReasoningEffortSchema.optional(),
    default_agent: z
      .string()
      .optional()
      .describe(
        "Default agent to use when none is specified. Must be a primary agent. Falls back to 'build' if not set or if the specified agent is invalid.",
      ),
    username: z.string().optional().describe("Custom username to display in conversations instead of system username"),
    formatter: z
      .union([
        z.literal(false),
        z.record(
          z.string(),
          z.object({
            disabled: z.boolean().optional(),
            command: z.array(z.string()).optional(),
            environment: z.record(z.string(), z.string()).optional(),
            extensions: z.array(z.string()).optional(),
          }),
        ),
      ])
      .optional(),
    instructions: z.array(z.string()).optional().describe("Additional instruction files or patterns to include"),
    tools: z.record(z.string(), z.boolean()).optional(),
    permission_mode: PermissionMode.optional().describe("Global tool permission mode"),
    mcp: McpConfigField,
    selected_mcp_servers: SelectedMcpServersField,
    selected_skills: SelectedSkillsField,
    selected_plugins: SelectedPluginsField,
    prompt_overrides: PromptOverridesField,
    custom_prompt_presets: CustomPromptPresetsField,
    selected_system_prompt_preset: SelectedSystemPromptPresetField,
    selected_plan_mode_prompt_preset: SelectedPlanModePromptPresetField,
    selected_git_commit_prompt_preset: SelectedGitCommitPromptPresetField,
    enterprise: z
      .object({
        url: z.string().optional().describe("Enterprise URL"),
      })
      .optional(),
    compaction: z
      .object({
        auto: z.boolean().optional().describe("Enable automatic compaction when context is full (default: true)"),
        prune: z.boolean().optional().describe("Enable pruning of old tool outputs (default: true)"),
      })
      .optional(),
    experimental: z
      .object({
        hook: z
          .object({
            file_edited: z
              .record(
                z.string(),
                z
                  .object({
                    command: z.string().array(),
                    environment: z.record(z.string(), z.string()).optional(),
                  })
                  .array(),
              )
              .optional(),
            session_completed: z
              .object({
                command: z.string().array(),
                environment: z.record(z.string(), z.string()).optional(),
              })
              .array()
              .optional(),
          })
          .optional(),
        chatMaxRetries: z.number().optional().describe("Number of retries for chat completions on failure"),
        disable_paste_summary: z.boolean().optional(),
        batch_tool: z.boolean().optional().describe("Enable the batch tool"),
        openTelemetry: z
          .boolean()
          .optional()
          .describe("Enable OpenTelemetry spans for AI SDK calls (using the 'experimental_telemetry' flag)"),
        primary_tools: z
          .array(z.string())
          .optional()
          .describe("Tools that should only be available to primary agents."),
        continue_loop_on_deny: z.boolean().optional().describe("Continue the agent loop when a tool call is denied"),
        mcp_timeout: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Timeout in milliseconds for model context protocol (MCP) requests"),
        toolSearch: z
          .boolean()
          .optional()
          .describe("Enable deferred MCP tool discovery through tool_search (default: true)"),
      })
      .optional(),
  })
  .strict()
  .meta({
    ref: "Config",
  })
export type Info = z.output<typeof Info>

const ProjectConfigRecord = z.object({
  projectID: z.string(),
  config: Info,
})
type ProjectConfigRecord = z.infer<typeof ProjectConfigRecord>

export const ProjectProviderConfig = z
  .object(ProviderConfigFields)
  .strict()
  .meta({
    ref: "ProjectProviderConfig",
  })
export type ProjectProviderConfig = z.infer<typeof ProjectProviderConfig>

export const ModelSelection = z
  .object(ModelSelectionFields)
  .strict()
  .meta({
    ref: "ProjectModelSelection",
  })
export type ModelSelection = z.infer<typeof ModelSelection>

export const ProjectMcpSelection = z
  .object({
    serverIDs: z.array(z.string()),
  })
  .strict()
  .meta({
    ref: "ProjectMcpSelection",
  })
export type ProjectMcpSelection = z.infer<typeof ProjectMcpSelection>

export const ProjectSkillSelection = z
  .object({
    skillIDs: z.array(z.string()),
  })
  .strict()
  .meta({
    ref: "ProjectSkillSelection",
  })
export type ProjectSkillSelection = z.infer<typeof ProjectSkillSelection>

export const ProjectPluginSelection = z
  .object({
    pluginIDs: z.array(z.string()),
  })
  .strict()
  .meta({
    ref: "ProjectPluginSelection",
  })
export type ProjectPluginSelection = z.infer<typeof ProjectPluginSelection>

function projectProviderConfigFromInfo(config: Info): ProjectProviderConfig {
  return {
    provider: config.provider,
    model: config.model,
    small_model: config.small_model,
    enabled_providers: config.enabled_providers,
    disabled_providers: config.disabled_providers,
  }
}

let projectConfigTableGeneration = -1

function ensureProjectConfigTable() {
  ensureLegacySessionCleanup()
  const generation = db.getDatabaseGeneration()
  if (projectConfigTableGeneration === generation && generation > 0) return
  if (db.tableExists("project_configs")) {
    projectConfigTableGeneration = db.getDatabaseGeneration()
    return
  }

  const columns = zodObjectToColumnDefs(ProjectConfigRecord)
  columns.projectID = withPrimaryKey(columns.projectID)
  db.db.run(toCreateTableSQL("project_configs", columns))
  projectConfigTableGeneration = db.getDatabaseGeneration()
}

function normalizeMcpServer(config: McpServerConfig): McpServerSummary {
  if (config.transport === "connector") {
    const connector = config as McpConnectorServerConfig
    return {
      id: connector.id,
      name: connector.name,
      transport: "connector",
      connectorId: connector.connectorId,
      connectorRuntimeId: connector.connectorRuntimeId,
      allowedTools: connector.allowedTools,
      toolPolicies: connector.toolPolicies,
      requireApproval: connector.requireApproval,
      provider: connector.provider,
      serverDescription: connector.serverDescription,
      enabled: connector.enabled ?? true,
      timeoutMs: connector.timeoutMs,
      owner: connector.owner,
    }
  }

  if ((config.transport ?? "stdio") === "remote") {
    const remote = config as McpRemoteServerConfig
    return {
      id: remote.id,
      name: remote.name,
      transport: "remote",
      serverUrl: remote.serverUrl,
      authorization: remote.authorization,
      headers: remote.headers,
      allowedTools: remote.allowedTools,
      toolPolicies: remote.toolPolicies,
      requireApproval: remote.requireApproval,
      provider: remote.provider,
      connectorId: remote.connectorId,
      connectorRuntimeId: remote.connectorRuntimeId,
      serverDescription: remote.serverDescription,
      enabled: remote.enabled ?? true,
      timeoutMs: remote.timeoutMs,
      owner: remote.owner,
    }
  }

  const stdio = config as McpStdioServerConfig
  return {
    ...stdio,
    transport: "stdio",
    enabled: stdio.enabled ?? true,
  }
}

function normalizeConfigID(configID: string | undefined) {
  const trimmed = configID?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : GLOBAL_CONFIG_ID
}

function normalizeMcpServerIDs(serverIDs: string[]) {
  const seen = new Set<string>()
  const result: string[] = []

  for (const serverID of serverIDs) {
    const trimmed = serverID.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
  }

  return result
}

function normalizeSkillIDs(skillIDs: string[]) {
  const seen = new Set<string>()
  const result: string[] = []

  for (const skillID of skillIDs) {
    const trimmed = skillID.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
  }

  return result
}

function normalizePluginIDs(pluginIDs: string[]) {
  const seen = new Set<string>()
  const result: string[] = []

  for (const pluginID of pluginIDs) {
    const trimmed = pluginID.trim().toLowerCase()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
  }

  return result
}

function normalizeToolSelection(tools: Record<string, boolean>) {
  const result: Record<string, boolean> = {}

  for (const [toolID, enabled] of Object.entries(tools)) {
    const normalizedToolID = toolID.trim()
    if (!normalizedToolID) continue
    result[normalizedToolID] = enabled
  }

  return result
}

function normalizePromptOverrides(overrides: Record<string, string>) {
  const result: Record<string, string> = {}

  for (const [presetID, content] of Object.entries(overrides)) {
    const normalizedPresetID = presetID.trim()
    if (!normalizedPresetID) continue
    result[normalizedPresetID] = content
  }

  return result
}

function normalizePromptPresetID(presetID: string | undefined | null) {
  const normalizedPresetID = presetID?.trim()
  return normalizedPresetID && normalizedPresetID.length > 0 ? normalizedPresetID : undefined
}

function normalizeCustomPromptPreset(preset: CustomPromptPreset): CustomPromptPreset {
  return {
    label: preset.label.trim(),
    content: preset.content,
    description: preset.description?.trim() || undefined,
  }
}

function normalizeCustomPromptPresets(presets: Record<string, CustomPromptPreset>) {
  const result: Record<string, CustomPromptPreset> = {}

  for (const [presetID, preset] of Object.entries(presets)) {
    const normalizedPresetID = normalizePromptPresetID(presetID)
    if (!normalizedPresetID) continue

    const normalizedPreset = normalizeCustomPromptPreset(preset)
    if (!normalizedPreset.label) continue
    result[normalizedPresetID] = normalizedPreset
  }

  return result
}

function readConfig(configID: string): Info {
  ensureProjectConfigTable()
  const row = db.findById("project_configs", ProjectConfigRecord, configID, "projectID")
  return row?.config ?? {}
}

function writeConfig(configID: string, config: Info) {
  ensureProjectConfigTable()
  db.upsert(
    "project_configs",
    {
      projectID: configID,
      config,
    },
    ["projectID"],
  )
  log.info("config-updated", {
    configID,
    keys: Object.keys(config),
  })
  return config
}

export async function get(configID = GLOBAL_CONFIG_ID) {
  return readConfig(normalizeConfigID(configID))
}

export async function set(configID: string, config: Info) {
  const parsed = Info.parse(config)
  return writeConfig(normalizeConfigID(configID), parsed)
}

export async function merge(configID: string, patch: Partial<Info>) {
  const normalizedConfigID = normalizeConfigID(configID)
  const next = Info.parse(mergeDeep(readConfig(normalizedConfigID), patch))
  return writeConfig(normalizedConfigID, next)
}

export function mergeProviderConfig(previous: Provider | undefined, provider: Provider) {
  const parsed = Provider.parse(provider)
  return Provider.parse({
    ...previous,
    ...parsed,
    env: parsed.env ?? previous?.env,
    whitelist: parsed.whitelist ?? previous?.whitelist,
    blacklist: parsed.blacklist ?? previous?.blacklist,
    models: parsed.models ? mergeDeep(previous?.models ?? {}, parsed.models) : previous?.models,
    options: parsed.options ? mergeDeep(previous?.options ?? {}, parsed.options) : previous?.options,
  })
}

export async function setProvider(configID: string, providerID: string, provider: Provider) {
  const normalizedConfigID = normalizeConfigID(configID)
  const current = readConfig(normalizedConfigID)
  const previous = current.provider?.[providerID]
  const nextProvider = mergeProviderConfig(previous, provider)
  const next = Info.parse({
    ...current,
    provider: {
      ...(current.provider ?? {}),
      [providerID]: nextProvider,
    },
  })
  return writeConfig(normalizedConfigID, next)
}

export async function removeProvider(configID: string, providerID: string) {
  const normalizedConfigID = normalizeConfigID(configID)
  const current = readConfig(normalizedConfigID)
  const providers = { ...(current.provider ?? {}) }
  delete providers[providerID]

  const next: Info = {
    ...current,
    provider: Object.keys(providers).length > 0 ? providers : undefined,
    model: current.model?.startsWith(`${providerID}/`) ? undefined : current.model,
    small_model: current.small_model?.startsWith(`${providerID}/`) ? undefined : current.small_model,
    image_model: current.image_model?.startsWith(`${providerID}/`) ? undefined : current.image_model,
  }

  return writeConfig(normalizedConfigID, Info.parse(next))
}

export async function getProviderConfig(configID = GLOBAL_CONFIG_ID): Promise<ProjectProviderConfig> {
  const config = readConfig(normalizeConfigID(configID))
  return projectProviderConfigFromInfo(config)
}

export async function setModelSelection(configID: string, input: ModelSelection) {
  const normalizedConfigID = normalizeConfigID(configID)
  const current = readConfig(normalizedConfigID)
  const parsed = ModelSelection.parse(input)
  const next: Info = {
    ...current,
    model: parsed.model === null ? undefined : parsed.model ?? current.model,
    small_model: parsed.small_model === null ? undefined : parsed.small_model ?? current.small_model,
    image_model: parsed.image_model === null ? undefined : parsed.image_model ?? current.image_model,
    image_generation: parsed.image_generation === null
      ? undefined
      : parsed.image_generation ?? current.image_generation,
    reasoning_effort: parsed.reasoning_effort === null
      ? undefined
      : parsed.reasoning_effort ?? current.reasoning_effort,
  }
  return writeConfig(normalizedConfigID, Info.parse(next))
}

export async function getImageGenerationSettings(configID = GLOBAL_CONFIG_ID): Promise<ImageGenerationSettings> {
  const config = readConfig(normalizeConfigID(configID))
  return ImageGenerationSettings.parse(config.image_generation ?? {})
}

export async function setImageGenerationSettings(configID: string, input: ImageGenerationSettings) {
  const normalizedConfigID = normalizeConfigID(configID)
  const current = readConfig(normalizedConfigID)
  const parsed = ImageGenerationSettings.parse(input)
  const next: Info = {
    ...current,
    image_generation: Object.keys(parsed).length > 0 ? parsed : undefined,
  }
  return writeConfig(normalizedConfigID, Info.parse(next))
}

export async function listMcpServers(configID = GLOBAL_CONFIG_ID): Promise<McpServerSummary[]> {
  const config = readConfig(normalizeConfigID(configID))
  const servers = Object.values(config.mcp?.servers ?? {}).map((server) => normalizeMcpServer(server))
  return servers.toSorted((left, right) => left.id.localeCompare(right.id))
}

function readSelectedMcpServerIDs(configID: string) {
  const selected = readConfig(configID).selected_mcp_servers
  return selected ? normalizeMcpServerIDs(selected) : null
}

export async function getSelectedMcpServerIDs(configID: string): Promise<string[]> {
  return readSelectedMcpServerIDs(normalizeConfigID(configID)) ?? []
}

export async function setSelectedMcpServerIDs(configID: string, serverIDs: string[]) {
  const normalizedConfigID = normalizeConfigID(configID)
  const current = readConfig(normalizedConfigID)
  const next: Info = {
    ...current,
    selected_mcp_servers: normalizeMcpServerIDs(serverIDs),
  }

  return writeConfig(normalizedConfigID, Info.parse(next))
}

export async function removeSelectedMcpServerIDFromAllProjects(serverID: string): Promise<{
  affectedProjectIDs: string[]
  affectedCount: number
}> {
  const transaction = db.db.transaction(() => removeSelectedMcpServerIDFromAllProjectsInCurrentTransaction(serverID))
  return transaction()
}

export function removeSelectedMcpServerIDFromAllProjectsInCurrentTransaction(serverID: string): {
  affectedProjectIDs: string[]
  affectedCount: number
} {
  const normalizedServerID = serverID.trim()
  if (!normalizedServerID) return { affectedProjectIDs: [], affectedCount: 0 }

  ensureProjectConfigTable()
  const rows = db.findMany("project_configs", ProjectConfigRecord)
  const affected = rows.flatMap((row) => {
    const current = normalizeMcpServerIDs(row.config.selected_mcp_servers ?? [])
    if (!current.includes(normalizedServerID)) return []
    const next = Info.parse({
      ...row.config,
      selected_mcp_servers: current.filter((id) => id !== normalizedServerID),
    })
    return [{ projectID: row.projectID, config: next }]
  })

  for (const row of affected) {
    db.upsert("project_configs", row, ["projectID"])
  }

  const affectedProjectIDs = affected
    .map((row) => row.projectID)
    .filter((projectID) => projectID !== GLOBAL_CONFIG_ID)
  return {
    affectedProjectIDs,
    affectedCount: affectedProjectIDs.length,
  }
}

export async function replaceSelectedMcpServerIDInAllProjects(
  previousServerID: string,
  nextServerID: string,
): Promise<{
  affectedProjectIDs: string[]
  affectedCount: number
}> {
  const transaction = db.db.transaction(() =>
    replaceSelectedMcpServerIDInAllProjectsInCurrentTransaction(previousServerID, nextServerID)
  )
  return transaction()
}

export function replaceSelectedMcpServerIDInAllProjectsInCurrentTransaction(
  previousServerID: string,
  nextServerID: string,
): {
  affectedProjectIDs: string[]
  affectedCount: number
} {
  const normalizedPreviousServerID = previousServerID.trim()
  const normalizedNextServerID = nextServerID.trim()
  if (
    !normalizedPreviousServerID
    || !normalizedNextServerID
    || normalizedPreviousServerID === normalizedNextServerID
  ) {
    return { affectedProjectIDs: [], affectedCount: 0 }
  }

  ensureProjectConfigTable()
  const rows = db.findMany("project_configs", ProjectConfigRecord)
  const affected = rows.flatMap((row) => {
    const current = normalizeMcpServerIDs(row.config.selected_mcp_servers ?? [])
    if (!current.includes(normalizedPreviousServerID)) return []
    const next = Info.parse({
      ...row.config,
      selected_mcp_servers: normalizeMcpServerIDs(
        current.map((id) => id === normalizedPreviousServerID ? normalizedNextServerID : id),
      ),
    })
    return [{ projectID: row.projectID, config: next }]
  })

  for (const row of affected) {
    db.upsert("project_configs", row, ["projectID"])
  }

  const affectedProjectIDs = affected
    .map((row) => row.projectID)
    .filter((projectID) => projectID !== GLOBAL_CONFIG_ID)
  return {
    affectedProjectIDs,
    affectedCount: affectedProjectIDs.length,
  }
}

function readSelectedSkillIDs(configID: string) {
  const selected = readConfig(configID).selected_skills
  return selected ? normalizeSkillIDs(selected) : null
}

export async function getSelectedSkillIDs(configID: string): Promise<string[]> {
  return readSelectedSkillIDs(normalizeConfigID(configID)) ?? []
}

export async function setSelectedSkillIDs(configID: string, skillIDs: string[]) {
  const normalizedConfigID = normalizeConfigID(configID)
  const current = readConfig(normalizedConfigID)
  const next: Info = {
    ...current,
    selected_skills: normalizeSkillIDs(skillIDs),
  }

  return writeConfig(normalizedConfigID, Info.parse(next))
}

export async function removeSelectedSkillIDFromAllProjects(skillID: string): Promise<{
  affectedProjectIDs: string[]
  affectedCount: number
}> {
  const transaction = db.db.transaction(() => removeSelectedSkillIDFromAllProjectsInCurrentTransaction(skillID))
  return transaction()
}

export function removeSelectedSkillIDFromAllProjectsInCurrentTransaction(skillID: string): {
  affectedProjectIDs: string[]
  affectedCount: number
} {
  const normalizedSkillID = skillID.trim()
  if (!normalizedSkillID) return { affectedProjectIDs: [], affectedCount: 0 }

  ensureProjectConfigTable()
  const rows = db.findMany("project_configs", ProjectConfigRecord)
  const affected = rows.flatMap((row) => {
    const current = normalizeSkillIDs(row.config.selected_skills ?? [])
    if (!current.includes(normalizedSkillID)) return []
    const next = Info.parse({
      ...row.config,
      selected_skills: current.filter((id) => id !== normalizedSkillID),
    })
    return [{ projectID: row.projectID, config: next }]
  })

  if (process.env.ANYBOX_TEST_FAIL_SKILL_SELECTION_CLEANUP === "1") {
    throw new Error("Injected selected-skill cleanup failure.")
  }
  for (const row of affected) {
    db.upsert("project_configs", row, ["projectID"])
  }

  const affectedProjectIDs = affected
    .map((row) => row.projectID)
    .filter((projectID) => projectID !== GLOBAL_CONFIG_ID)
  return {
    affectedProjectIDs,
    affectedCount: affectedProjectIDs.length,
  }
}

function readSelectedPluginIDs(configID: string) {
  const selected = readConfig(configID).selected_plugins
  return selected ? normalizePluginIDs(selected) : null
}

export async function getSelectedPluginIDs(configID: string): Promise<string[]> {
  return readSelectedPluginIDs(normalizeConfigID(configID)) ?? []
}

export async function setSelectedPluginIDs(configID: string, pluginIDs: string[]) {
  const normalizedConfigID = normalizeConfigID(configID)
  const current = readConfig(normalizedConfigID)
  const next: Info = {
    ...current,
    selected_plugins: normalizePluginIDs(pluginIDs),
  }

  return writeConfig(normalizedConfigID, Info.parse(next))
}

export async function getToolSelection(configID = GLOBAL_CONFIG_ID): Promise<{ tools: Record<string, boolean> }> {
  const config = readConfig(normalizeConfigID(configID))
  return {
    tools: config.tools ? normalizeToolSelection(config.tools) : {},
  }
}

export async function setToolSelection(configID: string, tools: Record<string, boolean>) {
  const normalizedConfigID = normalizeConfigID(configID)
  const current = readConfig(normalizedConfigID)
  const normalizedTools = normalizeToolSelection(tools)
  const next: Info = {
    ...current,
    tools: Object.keys(normalizedTools).length > 0 ? normalizedTools : undefined,
  }

  const config = writeConfig(normalizedConfigID, Info.parse(next))
  return {
    tools: config.tools ? normalizeToolSelection(config.tools) : {},
  }
}

export async function getPermissionMode(configID = GLOBAL_CONFIG_ID): Promise<{ mode: PermissionMode }> {
  const config = readConfig(normalizeConfigID(configID))
  return {
    mode: config.permission_mode ?? DEFAULT_PERMISSION_MODE,
  }
}

export async function setPermissionMode(configID: string, mode: PermissionMode) {
  const normalizedConfigID = normalizeConfigID(configID)
  const current = readConfig(normalizedConfigID)
  const next: Info = {
    ...current,
    permission_mode: PermissionMode.parse(mode),
  }

  const config = writeConfig(normalizedConfigID, Info.parse(next))
  return {
    mode: config.permission_mode ?? DEFAULT_PERMISSION_MODE,
  }
}

export async function getPromptOverrides(configID = GLOBAL_CONFIG_ID): Promise<Record<string, string>> {
  const config = readConfig(normalizeConfigID(configID))
  return config.prompt_overrides ? normalizePromptOverrides(config.prompt_overrides) : {}
}

export async function setPromptOverride(configID: string, presetID: string, content: string) {
  const normalizedConfigID = normalizeConfigID(configID)
  const normalizedPresetID = presetID.trim()
  const current = readConfig(normalizedConfigID)
  const nextOverrides = normalizePromptOverrides({
    ...(current.prompt_overrides ?? {}),
    [normalizedPresetID]: content,
  })
  const next: Info = {
    ...current,
    prompt_overrides: nextOverrides,
  }

  return writeConfig(normalizedConfigID, Info.parse(next))
}

export async function clearPromptOverride(configID: string, presetID: string) {
  const normalizedConfigID = normalizeConfigID(configID)
  const normalizedPresetID = presetID.trim()
  const current = readConfig(normalizedConfigID)
  const nextOverrides = { ...(current.prompt_overrides ?? {}) }
  delete nextOverrides[normalizedPresetID]
  const normalizedOverrides = normalizePromptOverrides(nextOverrides)
  const next: Info = {
    ...current,
    prompt_overrides: Object.keys(normalizedOverrides).length > 0 ? normalizedOverrides : undefined,
  }

  return writeConfig(normalizedConfigID, Info.parse(next))
}

export async function getCustomPromptPresets(
  configID = GLOBAL_CONFIG_ID,
): Promise<Record<string, CustomPromptPreset>> {
  const config = readConfig(normalizeConfigID(configID))
  return config.custom_prompt_presets
    ? normalizeCustomPromptPresets(config.custom_prompt_presets)
    : {}
}

export async function setCustomPromptPreset(
  configID: string,
  presetID: string,
  preset: CustomPromptPreset,
) {
  const normalizedConfigID = normalizeConfigID(configID)
  const normalizedPresetID = normalizePromptPresetID(presetID)
  if (!normalizedPresetID) {
    throw new Error("Prompt preset id is required.")
  }

  const normalizedPreset = normalizeCustomPromptPreset(preset)
  if (!normalizedPreset.label) {
    throw new Error("Prompt preset label is required.")
  }

  const current = readConfig(normalizedConfigID)
  const nextPresets = normalizeCustomPromptPresets({
    ...(current.custom_prompt_presets ?? {}),
    [normalizedPresetID]: normalizedPreset,
  })
  const next: Info = {
    ...current,
    custom_prompt_presets: nextPresets,
  }

  return writeConfig(normalizedConfigID, Info.parse(next))
}

export async function removeCustomPromptPreset(configID: string, presetID: string) {
  const normalizedConfigID = normalizeConfigID(configID)
  const normalizedPresetID = normalizePromptPresetID(presetID)
  if (!normalizedPresetID) return undefined

  const current = readConfig(normalizedConfigID)
  const nextPresets = { ...(current.custom_prompt_presets ?? {}) }
  delete nextPresets[normalizedPresetID]
  const normalizedPresets = normalizeCustomPromptPresets(nextPresets)
  const next: Info = {
    ...current,
    custom_prompt_presets: Object.keys(normalizedPresets).length > 0 ? normalizedPresets : undefined,
  }

  return writeConfig(normalizedConfigID, Info.parse(next))
}

export async function clearPromptPresetLegacyStorage(configID = GLOBAL_CONFIG_ID) {
  const normalizedConfigID = normalizeConfigID(configID)
  const current = readConfig(normalizedConfigID)
  if (!current.prompt_overrides && !current.custom_prompt_presets) {
    return current
  }

  const next: Info = {
    ...current,
    prompt_overrides: undefined,
    custom_prompt_presets: undefined,
  }

  return writeConfig(normalizedConfigID, Info.parse(next))
}

export async function getSelectedSystemPromptPresetID(configID = GLOBAL_CONFIG_ID) {
  return normalizePromptPresetID(readConfig(normalizeConfigID(configID)).selected_system_prompt_preset)
}

export async function getSelectedPlanModePromptPresetID(configID = GLOBAL_CONFIG_ID) {
  return normalizePromptPresetID(readConfig(normalizeConfigID(configID)).selected_plan_mode_prompt_preset)
}

export async function getSelectedGitCommitPromptPresetID(configID = GLOBAL_CONFIG_ID) {
  return normalizePromptPresetID(readConfig(normalizeConfigID(configID)).selected_git_commit_prompt_preset)
}

export async function setSelectedPromptPresetIDs(
  configID: string,
  selection: {
    systemPromptPresetID?: string | null
    planModePromptPresetID?: string | null
    gitCommitPromptPresetID?: string | null
  },
) {
  const normalizedConfigID = normalizeConfigID(configID)
  const current = readConfig(normalizedConfigID)
  const systemPromptPresetID = normalizePromptPresetID(selection.systemPromptPresetID)
  const planModePromptPresetID = normalizePromptPresetID(selection.planModePromptPresetID)
  const gitCommitPromptPresetID = normalizePromptPresetID(selection.gitCommitPromptPresetID)
  const next: Info = {
    ...current,
    selected_system_prompt_preset: systemPromptPresetID,
    selected_plan_mode_prompt_preset: planModePromptPresetID,
    selected_git_commit_prompt_preset: gitCommitPromptPresetID,
  }

  return writeConfig(normalizedConfigID, Info.parse(next))
}

export async function resolveProjectMcpServers(projectID: string): Promise<McpServerSummary[]> {
  const normalizedProjectID = normalizeConfigID(projectID)
  const selectedServerIDs = readSelectedMcpServerIDs(normalizedProjectID)
  const selectedPluginIDs = readSelectedPluginIDs(normalizedProjectID) ?? []
  const pluginModule = await import("#plugin/plugin.ts")
  const selectedPluginOwnedServerIDs = new Set(
    pluginModule.resolveEnabledInstalledPluginMcpServerIDs(selectedPluginIDs),
  )
  const selectedPluginMcpRequirementServerIDs = new Set(
    pluginModule.resolveEnabledInstalledPluginMcpRequirementServerIDs(selectedPluginIDs),
  )
  const selectedPluginConnectorRequirementServerIDs = new Set(
    pluginModule.resolveEnabledInstalledPluginConnectorRequirementServerIDs(selectedPluginIDs),
  )
  const globalServers = await listMcpServers(GLOBAL_CONFIG_ID)
  const selectedPluginServerIDs = new Set(
    globalServers
      .filter((server) =>
        selectedPluginOwnedServerIDs.has(server.id) ||
        selectedPluginMcpRequirementServerIDs.has(server.id) ||
        selectedPluginConnectorRequirementServerIDs.has(server.id),
      )
      .map((server) => server.id),
  )

  if (selectedServerIDs !== null) {
    const selectedServerIDSet = new Set(selectedServerIDs)
    return globalServers.filter((server) => selectedServerIDSet.has(server.id) || selectedPluginServerIDs.has(server.id))
  }

  const projectServers = await listMcpServers(normalizedProjectID)
  if (selectedPluginServerIDs.size === 0) return projectServers

  const projectServerIDs = new Set(projectServers.map((server) => server.id))
  return [
    ...projectServers,
    ...globalServers.filter((server) => selectedPluginServerIDs.has(server.id) && !projectServerIDs.has(server.id)),
  ]
}

export async function resolveDiscoverableProjectMcpServers(projectID: string): Promise<McpServerSummary[]> {
  const normalizedProjectID = normalizeConfigID(projectID)
  const [globalServers, projectServers] = await Promise.all([
    listMcpServers(GLOBAL_CONFIG_ID),
    normalizedProjectID === GLOBAL_CONFIG_ID
      ? Promise.resolve([] as McpServerSummary[])
      : listMcpServers(normalizedProjectID),
  ])
  const serversByID = new Map<string, McpServerSummary>()

  for (const server of projectServers) {
    serversByID.set(server.id, server)
  }
  for (const server of globalServers) {
    // Match getProjectMcpServer(): global definitions win duplicate ids.
    serversByID.set(server.id, server)
  }

  return [...serversByID.values()]
    .filter((server) => server.enabled)
    .toSorted((left, right) => left.id.localeCompare(right.id))
}

export async function getProjectMcpServer(projectID: string, serverID: string): Promise<McpServerSummary | undefined> {
  const normalizedProjectID = normalizeConfigID(projectID)
  const trimmedServerID = serverID.trim()
  if (!trimmedServerID) return undefined

  const globalServer = await getMcpServer(GLOBAL_CONFIG_ID, trimmedServerID)
  if (globalServer) return globalServer

  return await getMcpServer(normalizedProjectID, trimmedServerID)
}

export async function getMcpServer(configID: string, serverID: string): Promise<McpServerSummary | undefined> {
  const config = readConfig(normalizeConfigID(configID))
  const server = config.mcp?.servers?.[serverID]
  if (!server) return undefined
  return normalizeMcpServer(server)
}

function parsePublicMcpServerInput(server: McpServerInput) {
  const { owner: _ignoredOwner, ...input } = server as McpServerInput & { owner?: unknown }
  return McpServerInput.parse(input)
}

function writeMcpServer(
  normalizedConfigID: string,
  current: Info,
  serverID: string,
  server: McpServerInput,
  owner: McpServerOwner | undefined,
) {
  const input = parsePublicMcpServerInput(server)
  const parsed = McpServerConfig.parse({
    ...input,
    id: serverID,
    owner,
  })
  const next: Info = {
    ...current,
    mcp: {
      servers: {
        ...(current.mcp?.servers ?? {}),
        [serverID]: parsed,
      },
    },
  }
  writeConfig(normalizedConfigID, Info.parse(next))
  return normalizeMcpServer(parsed)
}

export async function setMcpServer(configID: string, serverID: string, server: McpServerInput) {
  const normalizedConfigID = normalizeConfigID(configID)
  const current = readConfig(normalizedConfigID)
  const existing = current.mcp?.servers?.[serverID]
  const owner: McpServerOwner | undefined = existing
    ? existing.owner
    : {
        kind: "user",
      }
  return writeMcpServer(normalizedConfigID, current, serverID, server, owner)
}

export async function setManagedMcpServer(
  configID: string,
  serverID: string,
  server: McpServerInput,
  owner: McpServerOwner,
) {
  const normalizedConfigID = normalizeConfigID(configID)
  const current = readConfig(normalizedConfigID)
  return writeMcpServer(normalizedConfigID, current, serverID, server, McpServerOwner.parse(owner))
}

export async function removeMcpServer(configID: string, serverID: string) {
  const normalizedConfigID = normalizeConfigID(configID)
  const current = readConfig(normalizedConfigID)
  const servers = { ...(current.mcp?.servers ?? {}) }
  const removed = servers[serverID]
  delete servers[serverID]

  const next: Info = {
    ...current,
    mcp:
      Object.keys(servers).length > 0
        ? {
            servers,
          }
        : undefined,
  }
  writeConfig(normalizedConfigID, Info.parse(next))
  return removed ? normalizeMcpServer(removed) : undefined
}
