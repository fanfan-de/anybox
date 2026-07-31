import z from "zod"
import fuzzysort from "fuzzysort"
import { mapValues } from "remeda"
import type { ImageModel, LanguageModel, Provider, Provider as SDKProvider } from "ai"
import { Instance } from "#project/instance.ts"
import { NamedError } from "#util/error.ts"
import { BunProc } from "#bun/index.ts"
import * as ModelsDev from "#provider/modelsdev.ts"
import * as Config from "#config/config.ts"
import * as Env from "#env/env.ts"
import * as Log from "#util/log.ts"
import * as AnyboxHTTP from "#provider/anybox-http.ts"
import * as ProviderAuth from "#auth/provider-auth.ts"

const OPENAI_SDK_PACKAGE = "@ai-sdk/openai"
const OPENAI_COMPATIBLE_SDK_PACKAGE = "@ai-sdk/openai-compatible"
const DEEPSEEK_SDK_PACKAGE = "@ai-sdk/deepseek"
const OPENROUTER_SDK_PACKAGE = "@openrouter/ai-sdk-provider"
const GOOGLE_VERTEX_SDK_PACKAGE = "@ai-sdk/google-vertex"
const PROVIDER_VALIDATION_TIMEOUT_MS = 10_000
const OPENAI_PROVIDER_ID = "openai"
const DEEPSEEK_PROVIDER_ID = "deepseek"
const ANYBOX_PROVIDER_ID = "anybox"
const OPENAI_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex"
const OPENAI_CODEX_MODELS_TIMEOUT_MS = 5_000
const OPENAI_CODEX_CLIENT_VERSION =
  firstNonEmptyString(process.env["ANYBOX_OPENAI_CODEX_CLIENT_VERSION"]) ?? "0.133.0"
const ANYBOX_SDK_TYPE_TO_NPM: Record<string, string> = {
  anthropic: "@ai-sdk/anthropic",
  deepseek: DEEPSEEK_SDK_PACKAGE,
  google: "@ai-sdk/google",
  "google-vertex": GOOGLE_VERTEX_SDK_PACKAGE,
  groq: "@ai-sdk/groq",
  mistral: "@ai-sdk/mistral",
  openai: OPENAI_SDK_PACKAGE,
  "openai-compatible": OPENAI_COMPATIBLE_SDK_PACKAGE,
  openrouter: OPENROUTER_SDK_PACKAGE,
  perplexity: "@ai-sdk/perplexity",
  xai: "@ai-sdk/xai",
}
const log = Log.create({ service: "provider" })

class AnyboxModelCatalogError extends Error {
  override name = "AnyboxModelCatalogError"
}

// -----------------------------------------------------------------------------
// 共享的 schema 和对外 DTO
// -----------------------------------------------------------------------------

export const ModelReference = z
  .object({
    providerID: z.string(),
    modelID: z.string(),
  })
  .meta({
    ref: "ModelReference",
  })
export type ModelReference = z.infer<typeof ModelReference>

export const Model = z
  .object({
    id: z.string(),
    providerID: z.string(),
    api: z.object({
      id: z.string(),
      url: z.string(),
      npm: z.string(),
    }),
    name: z.string(),
    family: z.string().optional(),
    capabilities: z.object({
      temperature: z.boolean(),
      reasoning: z.boolean(),
      replayAssistantReasoning: z.boolean(),
      attachment: z.boolean(),
      toolcall: z.boolean(),
      input: z.object({
        text: z.boolean(),
        audio: z.boolean(),
        image: z.boolean(),
        video: z.boolean(),
        pdf: z.boolean(),
      }),
      output: z.object({
        text: z.boolean(),
        audio: z.boolean(),
        image: z.boolean(),
        video: z.boolean(),
        pdf: z.boolean(),
      }),
      interleaved: z.union([
        z.boolean(),
        z.object({
          field: z.enum(["reasoning_content", "reasoning_details"]),
        }),
      ]),
    }),
    cost: z.object({
      input: z.number(),
      output: z.number(),
      cache: z.object({
        read: z.number(),
        write: z.number(),
      }),
      experimentalOver200K: z
        .object({
          input: z.number(),
          output: z.number(),
          cache: z.object({
            read: z.number(),
            write: z.number(),
          }),
        })
        .optional(),
    }),
    limit: z.object({
      context: z.number(),
      input: z.number().optional(),
      output: z.number(),
    }),
    status: z.enum(["alpha", "beta", "deprecated", "active"]),
    options: z.record(z.string(), z.any()),
    headers: z.record(z.string(), z.string()),
    release_date: z.string(),
    variants: z.record(z.string(), z.record(z.string(), z.any())).optional(),
  })
  .meta({
    ref: "Model",
  })
export type Model = z.infer<typeof Model>

export const testDeepSeekModel: Model = {
  id: "deepseek-chat",
  providerID: "deepseek",
  api: {
    id: "deepseek-chat",
    url: "https://api.deepseek.com/v1",
    npm: DEEPSEEK_SDK_PACKAGE,
  },
  name: "DeepSeek Chat",
  family: "deepseek",
  capabilities: {
    temperature: true,
    reasoning: false,
    replayAssistantReasoning: true,
    attachment: false,
    toolcall: true,
    input: {
      text: true,
      audio: false,
      image: false,
      video: false,
      pdf: false,
    },
    output: {
      text: true,
      audio: false,
      image: false,
      video: false,
      pdf: false,
    },
    interleaved: false,
  },
  cost: {
    input: 0,
    output: 0,
    cache: {
      read: 0,
      write: 0,
    },
  },
  limit: {
    context: 128_000,
    output: 8_000,
  },
  status: "active",
  options: {},
  headers: {},
  release_date: "2024-01-01",
}

export const ProviderInfo = z
  .object({
    id: z.string(),
    name: z.string(),
    source: z.enum(["env", "config", "custom", "api"]),
    env: z.string().array(),
    key: z.string().optional(),
    options: z.record(z.string(), z.any()),
    models: z.record(z.string(), Model),
    displayBaseURL: z.string().optional(),
    runtimeBaseURL: z.string().optional(),
    runtimeHeaders: z.record(z.string(), z.string()).optional(),
    credentialKind: z.enum(["api_key", "oauth_session"]).optional(),
    credentialSource: z.enum(["credential_store", "legacy_config", "environment", "external_cache"]).optional(),
    activeMethod: z.string().optional(),
    authCapabilities: z.array(ProviderAuth.ProviderAuthCapability).optional(),
    authState: ProviderAuth.ProviderAuthState.optional(),
  })
  .meta({
    ref: "Provider",
  })
export type ProviderInfo = z.infer<typeof ProviderInfo>

export const PublicModel = Model.omit({
  headers: true,
}).extend({
  available: z.boolean(),
  providerName: z.string().optional(),
})
export type PublicModel = z.infer<typeof PublicModel>

export const PublicProvider = z
  .object({
    id: z.string(),
    name: z.string(),
    source: z.enum(["env", "config", "custom", "api"]),
    env: z.array(z.string()),
    configured: z.boolean(),
    isCustomProvider: z.boolean(),
    available: z.boolean(),
    apiKeyConfigured: z.boolean(),
    baseURL: z.string().optional(),
    customChatEndpoint: z.string().optional(),
    customDefaultModel: z.string().optional(),
    modelCount: z.number(),
    authCapabilities: z.array(ProviderAuth.ProviderAuthCapability),
    authState: ProviderAuth.ProviderAuthState,
    authScope: z.literal("global"),
    activeAuthMethod: z.string().optional(),
    connectionLabel: z.string().optional(),
    lastAuthError: z.string().optional(),
    models: z.array(PublicModel),
  })
  .meta({
    ref: "PublicProvider",
  })
export type PublicProvider = z.infer<typeof PublicProvider>

export const ProviderCatalogItem = z
  .object({
    id: z.string(),
    name: z.string(),
    source: z.enum(["env", "config", "custom", "api"]),
    env: z.array(z.string()),
    configured: z.boolean(),
    isCustomProvider: z.boolean(),
    available: z.boolean(),
    apiKeyConfigured: z.boolean(),
    baseURL: z.string().optional(),
    customChatEndpoint: z.string().optional(),
    customDefaultModel: z.string().optional(),
    modelCount: z.number(),
    authCapabilities: z.array(ProviderAuth.ProviderAuthCapability),
    authState: ProviderAuth.ProviderAuthState,
    authScope: z.literal("global"),
    activeAuthMethod: z.string().optional(),
    connectionLabel: z.string().optional(),
    lastAuthError: z.string().optional(),
  })
  .meta({
    ref: "ProviderCatalogItem",
  })
export type ProviderCatalogItem = z.infer<typeof ProviderCatalogItem>

const sdkState = Instance.state(() => new Map<string, SDKProvider>())
const languageState = Instance.state(() => new Map<string, LanguageModel>())
const globalSdkState = new Map<string, SDKProvider>()
const globalLanguageState = new Map<string, LanguageModel>()

function getSDKState(configID: string) {
  return configID === Config.GLOBAL_CONFIG_ID ? globalSdkState : sdkState()
}

function getLanguageState(configID: string) {
  return configID === Config.GLOBAL_CONFIG_ID ? globalLanguageState : languageState()
}

type ProviderFunctionOverrides = {
  getSelection?: (configID?: string) => Promise<{
    model?: string
    small_model?: string
    image_model?: string
    image_generation?: Config.ImageGenerationSettings
    reasoning_effort?: Config.Info["reasoning_effort"]
  }>
  getDefaultModelRef?: (configID?: string) => Promise<ModelReference>
  getModel?: (providerID: string, modelID: string, configID?: string) => Promise<Model>
  listModels?: (configID?: string) => Promise<PublicModel[]>
  getLanguage?: (model: Model, configID?: string) => Promise<LanguageModel>
}

let providerFunctionOverrides: ProviderFunctionOverrides = {}

export function setProviderFunctionOverridesForTesting(overrides: ProviderFunctionOverrides) {
  const previous = providerFunctionOverrides
  providerFunctionOverrides = {
    ...previous,
    ...overrides,
  }

  return () => {
    providerFunctionOverrides = previous
  }
}

type SDKFactoryInput = {
  provider: ProviderInfo
  apiKey: string | undefined
  baseURL: string | undefined
  headers: Record<string, string> | undefined
  fetch?: (input: any, init?: any) => Promise<Response>
}

type SDKModuleFactory = (options: Record<string, unknown>) => Provider

type ProviderRuntimeDependencies = {
  getModelsDev: typeof ModelsDev.get
  getConfig: typeof Config.get
  getEnvAll: typeof Env.all
  fetch: typeof fetch
  importPackage: (pkg: string, version?: string, importSpecifier?: string) => Promise<{
    module: Record<string, unknown>
    version?: string
  }>
}

const defaultProviderRuntimeDependencies: ProviderRuntimeDependencies = {
  getModelsDev: ModelsDev.get,
  getConfig: Config.get,
  getEnvAll: Env.all,
  fetch,
  importPackage: BunProc.importPackage,
}
let providerRuntimeDependencies = defaultProviderRuntimeDependencies

export function setProviderRuntimeDependenciesForTesting(
  overrides: Partial<ProviderRuntimeDependencies>,
) {
  const previous = providerRuntimeDependencies
  globalSdkState.clear()
  globalLanguageState.clear()
  providerRuntimeDependencies = {
    ...previous,
    ...overrides,
  }

  return () => {
    providerRuntimeDependencies = previous
    globalSdkState.clear()
    globalLanguageState.clear()
  }
}

type SDKAdapter = {
  version?: string
  exportName?: string
  installPackage?: string
  importSpecifier?: string
  create(input: SDKFactoryInput, factory: SDKModuleFactory): SDKProvider
}

function sdkFactoryOptions(input: SDKFactoryInput, extra: Record<string, unknown> = {}) {
  const options: Record<string, unknown> = {
    apiKey: input.apiKey,
    baseURL: input.baseURL,
    headers: input.headers,
    ...extra,
  }
  if (input.fetch) options.fetch = input.fetch
  return options
}

function createSDKProvider(input: SDKFactoryInput, factory: SDKModuleFactory) {
  return factory(sdkFactoryOptions(input)) as SDKProvider
}

function createNamedSDKProvider(input: SDKFactoryInput, factory: SDKModuleFactory) {
  return factory(sdkFactoryOptions(input, { name: input.provider.id })) as SDKProvider
}

function sdkAdapter(version: string, exportName: string, options?: {
  installPackage?: string
  importSpecifier?: string
  create?: SDKAdapter["create"]
}): SDKAdapter {
  return {
    version,
    exportName,
    installPackage: options?.installPackage,
    importSpecifier: options?.importSpecifier,
    create: options?.create ?? createSDKProvider,
  }
}

const SDK_ADAPTERS: Record<string, SDKAdapter> = {
  "@ai-sdk/amazon-bedrock": sdkAdapter("5.0.38", "createAmazonBedrock"),
  "@ai-sdk/anthropic": sdkAdapter("4.0.25", "createAnthropic"),
  "@ai-sdk/azure": sdkAdapter("4.0.26", "createAzure"),
  "@ai-sdk/cerebras": sdkAdapter("3.0.18", "createCerebras"),
  "@ai-sdk/cohere": sdkAdapter("4.0.16", "createCohere"),
  [DEEPSEEK_SDK_PACKAGE]: {
    version: "3.0.17",
    exportName: "createDeepSeek",
    create: createSDKProvider,
  },
  "@ai-sdk/deepinfra": sdkAdapter("3.0.18", "createDeepInfra"),
  "@ai-sdk/gateway": sdkAdapter("4.0.33", "createGateway"),
  "@ai-sdk/google": sdkAdapter("4.0.29", "createGoogleGenerativeAI"),
  [GOOGLE_VERTEX_SDK_PACKAGE]: sdkAdapter("5.0.36", "createVertex"),
  "@ai-sdk/google-vertex/anthropic": sdkAdapter("5.0.36", "createVertexAnthropic", {
    installPackage: GOOGLE_VERTEX_SDK_PACKAGE,
    importSpecifier: "@ai-sdk/google-vertex/anthropic",
  }),
  "@ai-sdk/groq": sdkAdapter("4.0.17", "createGroq"),
  "@ai-sdk/mistral": sdkAdapter("4.0.18", "createMistral"),
  [OPENAI_COMPATIBLE_SDK_PACKAGE]: {
    version: "3.0.18",
    exportName: "createOpenAICompatible",
    create(input: SDKFactoryInput, factory: SDKModuleFactory) {
      if (!input.baseURL) {
        throw new Error(
          `Provider '${input.provider.id}' requires a baseURL when using '${OPENAI_COMPATIBLE_SDK_PACKAGE}'`,
        )
      }

      return factory(sdkFactoryOptions(input, { name: input.provider.id })) as SDKProvider
    },
  },
  [OPENAI_SDK_PACKAGE]: {
    version: "4.0.25",
    exportName: "createOpenAI",
    create: createNamedSDKProvider,
  },
  "@ai-sdk/perplexity": sdkAdapter("4.0.18", "createPerplexity"),
  "@ai-sdk/togetherai": sdkAdapter("3.0.19", "createTogetherAI"),
  "@ai-sdk/vercel": sdkAdapter("3.0.18", "createVercel"),
  "@ai-sdk/xai": sdkAdapter("4.0.23", "createXai"),
  "@aihubmix/ai-sdk-provider": sdkAdapter("2.2.1", "createAihubmix"),
  "@jerome-benoit/sap-ai-provider-v2": sdkAdapter("4.8.0", "createSAPAIProvider"),
  [OPENROUTER_SDK_PACKAGE]: {
    version: "3.0.0",
    exportName: "createOpenRouter",
    create: createSDKProvider,
  },
  "ai-gateway-provider": sdkAdapter("4.0.0", "createAiGateway"),
  "gitlab-ai-provider": sdkAdapter("6.12.1", "createGitLab"),
  "venice-ai-sdk-provider": sdkAdapter("2.1.1", "createVenice"),
}

function sdkPackagesFromModelsDev(catalog: Record<string, ModelsDev.DevProvider>) {
  const result = new Set<string>()
  for (const provider of Object.values(catalog)) {
    if (provider.npm) result.add(provider.npm)
    for (const model of Object.values(provider.models)) {
      if (model.provider?.npm) result.add(model.provider.npm)
    }
  }
  return result
}

async function isModelsDevSDKPackage(npmPackage: string) {
  const catalog = await providerRuntimeDependencies.getModelsDev()
  return sdkPackagesFromModelsDev(catalog).has(npmPackage)
}

async function resolveSDKAdapter(requested: string): Promise<SDKAdapter> {
  const adapter = SDK_ADAPTERS[requested]
  if (adapter) return adapter

  if (await isModelsDevSDKPackage(requested)) {
    return {
      create: createSDKProvider,
    }
  }

  throw new Error(
    `Unsupported SDK package '${requested}'. Add it to the SDK adapter allowlist or models.dev catalog before using it in provider.npm or model.provider.npm.`,
  )
}

function resolveSDKFactory(npmPackage: string, adapter: SDKAdapter, module: Record<string, unknown>) {
  if (adapter.exportName) {
    const factory = module[adapter.exportName]
    if (typeof factory !== "function") {
      throw new Error(`SDK package '${npmPackage}' is missing export '${adapter.exportName}'`)
    }
    return factory as SDKModuleFactory
  }

  const candidates = Object.entries(module)
    .filter(([name, value]) => /^create[A-Z]/.test(name) && typeof value === "function")
    .map(([name, value]) => [name, value] as const)

  const candidate = candidates.length === 1 ? candidates[0] : undefined
  if (candidate) {
    return candidate[1] as SDKModuleFactory
  }

  const suffix = candidates.length
    ? `Found candidate exports: ${candidates.map(([name]) => name).join(", ")}.`
    : "No create* factory export was found."
  throw new Error(`SDK package '${npmPackage}' needs an explicit SDK adapter. ${suffix}`)
}

// -----------------------------------------------------------------------------
// 通用小工具
// -----------------------------------------------------------------------------

function firstNonEmptyString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value !== "string") continue
    const trimmed = value.trim()
    if (trimmed) return trimmed
  }
  return undefined
}

function parseNumeric(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function hasProviderConfig(config: Config.Info, providerID: string) {
  return Boolean(config.provider?.[providerID])
}

function isProviderAllowed(config: Config.Info, providerID: string) {
  if (config.enabled_providers && !config.enabled_providers.includes(providerID)) return false
  if (config.disabled_providers?.includes(providerID)) return false
  return true
}

function resolveProviderLegacyApiKey(
  provider: ProviderInfo,
  providerConfig: Config.Provider | undefined,
  env: Record<string, string | undefined>,
) {
  return firstNonEmptyString(
    providerConfig?.options?.apiKey,
    ...provider.env.map((item) => env[item]),
  )
}

function sanitizeProviderOptions(options: Config.Provider["options"]) {
  if (!options) return {}
  const {
    apiKey: _apiKey,
    proxyMode: _proxyMode,
    proxyURL: _proxyURL,
    ...rest
  } = options as Config.Provider["options"] & {
    proxyMode?: unknown
    proxyURL?: unknown
  }
  return rest
}

function hasRuntimeCredential(provider: ProviderInfo) {
  return Boolean(firstNonEmptyString(provider.key))
}

function hasApiKeyCredential(provider: ProviderInfo) {
  if (provider.credentialKind === "api_key") return true
  return false
}

function isCustomProvider(provider: ProviderInfo) {
  return provider.options.customProvider === true
}

function getCustomProviderChatEndpoint(provider: ProviderInfo) {
  if (!isCustomProvider(provider)) return undefined
  return readCustomProviderChatEndpoint(provider)
}

function getCustomProviderDefaultModel(provider: ProviderInfo) {
  if (!isCustomProvider(provider)) return undefined
  const value = provider.options.customDefaultModel
  if (typeof value === "string" && value.trim()) return value.trim()
  return Object.values(provider.models)[0]?.id
}

function isCustomProviderConfig(provider: Config.Provider | undefined) {
  return provider?.options?.customProvider === true
}

function isAvailable(provider: ProviderInfo) {
  if (provider.id === ANYBOX_PROVIDER_ID) {
    return provider.authState?.status === "connected" && hasRuntimeCredential(provider)
  }

  if (isCustomProvider(provider)) {
    return hasRuntimeCredential(provider)
  }

  if (provider.authState && provider.env.length > 0) {
    return provider.authState.status === "connected"
  }
  return hasRuntimeCredential(provider) || provider.env.length === 0
}

function parseModelReference(input: string | undefined) {
  if (!input) return undefined
  const [providerID, ...rest] = input.split("/")
  const modelID = rest.join("/")
  if (!providerID || !modelID) return undefined
  return {
    providerID,
    modelID,
  }
}

function resolveConfigID(configID?: string) {
  if (configID) return configID

  try {
    return Instance.project.id
  } catch {
    return Config.GLOBAL_CONFIG_ID
  }
}

function suggestMatches(input: string, candidates: string[]) {
  return fuzzysort
    .go(input, candidates, {
      limit: 3,
      threshold: -10000,
    })
    .map((item) => item.target)
}

// 当 provider 只存在于项目配置里、不存在于 models.dev catalog 里时，
// 先构造一个最小可用的 provider 骨架，后续再叠加配置与模型信息。
function getCapabilitiesFallback(providerID: string) {
  return ProviderAuth.getProviderAuthCapabilities(providerID)
}

function createFallbackAuthState(providerID: string) {
  return ProviderAuth.createDisconnectedProviderAuthState(providerID)
}

function isOpenAIChatGPTMethod(method: string) {
  return method === "chatgpt-browser" || method === "chatgpt-headless"
}

function createConfigOnlyProvider(providerID: string, providerConfig: Config.Provider | undefined): ProviderInfo {
  return {
    id: providerID,
    name: providerConfig?.name ?? providerID,
    source: "custom",
    env: providerConfig?.env ?? [],
    options: {},
    models: {},
  }
}

function normalizeAnyboxRootURL(baseURL?: string) {
  return AnyboxHTTP.normalizeAnyboxRootURL(baseURL)
}

function normalizeAnyboxApiURL(baseURL?: string) {
  return AnyboxHTTP.normalizeAnyboxApiURL(baseURL)
}

function sdkPackageFromAnyboxType(value: unknown) {
  const normalized = firstNonEmptyString(value)?.toLowerCase().replace(/[\s_]+/g, "-")
  return normalized ? ANYBOX_SDK_TYPE_TO_NPM[normalized] : undefined
}

function createAnyboxProvider(): ProviderInfo {
  return {
    id: ANYBOX_PROVIDER_ID,
    name: "Anybox",
    source: "api",
    env: [],
    options: {},
    models: {},
    displayBaseURL: normalizeAnyboxApiURL(),
  }
}

function createStaticModel(
  providerID: string,
  input: {
    id: string
    name: string
    family?: string
    reasoning?: boolean
    context?: number
    output?: number
  },
): Model {
  return {
    id: input.id,
    providerID,
    api: {
      id: input.id,
      url: OPENAI_CODEX_BASE_URL,
      npm: OPENAI_SDK_PACKAGE,
    },
    name: input.name,
    family: input.family,
    capabilities: {
      temperature: true,
      reasoning: input.reasoning ?? true,
      replayAssistantReasoning: true,
      attachment: true,
      toolcall: true,
      input: {
        text: true,
        audio: false,
        image: true,
        video: false,
        pdf: true,
      },
      output: {
        text: true,
        audio: false,
        image: false,
        video: false,
        pdf: false,
      },
      interleaved: false,
    },
    cost: {
      input: 0,
      output: 0,
      cache: {
        read: 0,
        write: 0,
      },
    },
    limit: {
      context: input.context ?? 200_000,
      output: input.output ?? 32_768,
    },
    status: "active",
    options: {},
    headers: {},
    release_date: "2026-04-22",
    variants: {},
  }
}

function openAICodexModels() {
  return {
    "gpt-5.4": createStaticModel(OPENAI_PROVIDER_ID, {
      id: "gpt-5.4",
      name: "GPT-5.4",
      family: "gpt-5",
    }),
    "gpt-5.4-mini": createStaticModel(OPENAI_PROVIDER_ID, {
      id: "gpt-5.4-mini",
      name: "GPT-5.4 Mini",
      family: "gpt-5",
      output: 16_384,
    }),
    "gpt-5.3-codex": createStaticModel(OPENAI_PROVIDER_ID, {
      id: "gpt-5.3-codex",
      name: "GPT-5.3 Codex",
      family: "gpt-5-codex",
    }),
  } satisfies Record<string, Model>
}

const OpenAICodexModelInfo = z.object({
  slug: z.string().min(1),
  display_name: z.string().optional(),
  description: z.string().optional().nullable(),
  default_reasoning_level: z.string().optional().nullable(),
  supported_reasoning_levels: z
    .array(
      z.object({
        effort: z.string(),
        description: z.string().optional(),
      }),
    )
    .default([]),
  visibility: z.string().default("list"),
  priority: z.number().default(Number.MAX_SAFE_INTEGER),
  context_window: z.number().int().positive().optional().nullable(),
  max_context_window: z.number().int().positive().optional().nullable(),
  input_modalities: z.array(z.string()).default(["text", "image"]),
})
type OpenAICodexModelInfo = z.infer<typeof OpenAICodexModelInfo>

function openAIModelFamily(modelID: string) {
  const normalized = modelID.trim().toLowerCase()
  if (normalized.includes("codex")) return normalized.startsWith("gpt-5") ? "gpt-5-codex" : "codex"
  const generation = normalized.match(/^gpt-(\d+)/)?.[1]
  return generation ? `gpt-${generation}` : normalized
}

export function openAICodexModelFromCatalog(item: OpenAICodexModelInfo): Model {
  const inputModalities = new Set(item.input_modalities.map((modality) => modality.toLowerCase()))
  const supportsImages = inputModalities.has("image")
  const supportsPdf = inputModalities.has("pdf") || supportsImages
  const reasoningEfforts = item.supported_reasoning_levels.map((preset) => preset.effort)
  const supportsReasoning =
    reasoningEfforts.some((effort) => effort !== "none") ||
    Boolean(item.default_reasoning_level && item.default_reasoning_level !== "none")

  return {
    id: item.slug,
    providerID: OPENAI_PROVIDER_ID,
    api: {
      id: item.slug,
      url: OPENAI_CODEX_BASE_URL,
      npm: OPENAI_SDK_PACKAGE,
    },
    name: firstNonEmptyString(item.display_name, item.slug) ?? item.slug,
    family: openAIModelFamily(item.slug),
    capabilities: {
      temperature: true,
      reasoning: supportsReasoning,
      replayAssistantReasoning: true,
      attachment: supportsImages || supportsPdf,
      toolcall: true,
      input: {
        text: inputModalities.has("text"),
        audio: inputModalities.has("audio"),
        image: supportsImages,
        video: inputModalities.has("video"),
        pdf: supportsPdf,
      },
      output: {
        text: true,
        audio: false,
        image: false,
        video: false,
        pdf: false,
      },
      interleaved: false,
    },
    cost: {
      input: 0,
      output: 0,
      cache: {
        read: 0,
        write: 0,
      },
    },
    limit: {
      context: item.context_window ?? item.max_context_window ?? 200_000,
      output: 32_768,
    },
    status: "active",
    options: {
      description: item.description ?? undefined,
      defaultReasoningEffort: item.default_reasoning_level ?? undefined,
      supportedReasoningEfforts: reasoningEfforts,
      priority: item.priority,
    },
    headers: {},
    release_date: "2026-01-01",
    variants: {},
  }
}

export async function fetchOpenAICodexModels(runtimeAuth: ProviderAuth.ProviderRuntimeAuth) {
  if (!runtimeAuth.apiKey) throw new Error("OpenAI Codex model discovery requires an access token")

  const baseURL = runtimeAuth.runtimeBaseURL ?? OPENAI_CODEX_BASE_URL
  const modelsURL = new URL("models", normalizeBaseURL(baseURL))
  modelsURL.searchParams.set("client_version", OPENAI_CODEX_CLIENT_VERSION)

  const response = await providerRuntimeDependencies.fetch(modelsURL, {
    method: "GET",
    headers: {
      accept: "application/json",
      ...runtimeAuth.runtimeHeaders,
      authorization: `Bearer ${runtimeAuth.apiKey}`,
    },
    signal: AbortSignal.timeout(OPENAI_CODEX_MODELS_TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new Error(`OpenAI Codex model discovery failed with HTTP ${response.status}`)
  }

  const payload = z.object({ models: z.array(z.unknown()) }).parse(await response.json())
  const models = payload.models
    .map((item) => OpenAICodexModelInfo.safeParse(item))
    .filter((result): result is z.ZodSafeParseSuccess<OpenAICodexModelInfo> => result.success)
    .map((result) => result.data)
    .filter((item) => item.visibility === "list")
    .sort((left, right) => left.priority - right.priority)
    .map(openAICodexModelFromCatalog)

  if (models.length === 0) {
    throw new Error("OpenAI Codex model discovery returned no visible models")
  }

  return Object.fromEntries(models.map((model) => [model.id, model]))
}

// -----------------------------------------------------------------------------
// 第一阶段：catalog + config + env -> 当前项目可见的 provider 视图
// 这一层每次查询都会重新解析一次，所以配置和环境变量的变化会立刻生效。
// -----------------------------------------------------------------------------

function createBaseModelFromConfig(
  providerID: string,
  providerConfig: Config.Provider | undefined,
  modelID: string,
  modelConfig: NonNullable<Config.Provider["models"]>[string],
): Model {
  return {
    id: modelID,
    providerID,
    api: {
      id: firstNonEmptyString(modelConfig.id, modelID) ?? modelID,
      url: firstNonEmptyString(modelConfig.provider?.api, providerConfig?.api, providerConfig?.options?.baseURL) ?? "",
      npm: firstNonEmptyString(modelConfig.provider?.npm, providerConfig?.npm) ?? OPENAI_SDK_PACKAGE,
    },
    name: firstNonEmptyString(modelConfig.name, modelID) ?? modelID,
    family: modelConfig.family,
    capabilities: {
      temperature: modelConfig.temperature ?? true,
      reasoning: modelConfig.reasoning ?? false,
      replayAssistantReasoning: modelConfig.replay_assistant_reasoning ?? true,
      attachment: modelConfig.attachment ?? false,
      toolcall: modelConfig.tool_call ?? true,
      input: {
        text: modelConfig.modalities?.input?.includes("text") ?? true,
        audio: modelConfig.modalities?.input?.includes("audio") ?? false,
        image: modelConfig.modalities?.input?.includes("image") ?? false,
        video: modelConfig.modalities?.input?.includes("video") ?? false,
        pdf: modelConfig.modalities?.input?.includes("pdf") ?? false,
      },
      output: {
        text: modelConfig.modalities?.output?.includes("text") ?? true,
        audio: modelConfig.modalities?.output?.includes("audio") ?? false,
        image: modelConfig.modalities?.output?.includes("image") ?? false,
        video: modelConfig.modalities?.output?.includes("video") ?? false,
        pdf: modelConfig.modalities?.output?.includes("pdf") ?? false,
      },
      interleaved: modelConfig.interleaved ?? false,
    },
    cost: {
      input: modelConfig.cost?.input ?? 0,
      output: modelConfig.cost?.output ?? 0,
      cache: {
        read: modelConfig.cost?.cache_read ?? 0,
        write: modelConfig.cost?.cache_write ?? 0,
      },
      experimentalOver200K: modelConfig.cost?.context_over_200k
        ? {
            input: modelConfig.cost.context_over_200k.input,
            output: modelConfig.cost.context_over_200k.output,
            cache: {
              read: modelConfig.cost.context_over_200k.cache_read ?? 0,
              write: modelConfig.cost.context_over_200k.cache_write ?? 0,
            },
          }
        : undefined,
    },
    limit: {
      context: modelConfig.limit?.context ?? 0,
      input: modelConfig.limit?.input,
      output: modelConfig.limit?.output ?? 0,
    },
    status: modelConfig.status ?? "active",
    options: modelConfig.options ?? {},
    headers: modelConfig.headers ?? {},
    release_date: modelConfig.release_date ?? "",
    variants: modelConfig.variants ?? {},
  }
}

function mergeModelApiURL(
  providerID: string,
  providerConfig: Config.Provider | undefined,
  baseModel: Model | undefined,
  modelConfig: NonNullable<Config.Provider["models"]>[string] | undefined,
) {
  if (providerID === ANYBOX_PROVIDER_ID) {
    return firstNonEmptyString(
      modelConfig?.provider?.api,
      baseModel?.api.url,
      providerConfig?.api,
      providerConfig?.options?.baseURL,
    )
  }

  return firstNonEmptyString(
    modelConfig?.provider?.api,
    providerConfig?.api,
    providerConfig?.options?.baseURL,
    baseModel?.api.url,
  )
}

function mergeModelNpmPackage(
  providerID: string,
  providerConfig: Config.Provider | undefined,
  baseModel: Model | undefined,
  modelConfig: NonNullable<Config.Provider["models"]>[string] | undefined,
) {
  if (providerID === ANYBOX_PROVIDER_ID) {
    return firstNonEmptyString(modelConfig?.provider?.npm, baseModel?.api.npm, providerConfig?.npm)
  }

  return firstNonEmptyString(modelConfig?.provider?.npm, providerConfig?.npm, baseModel?.api.npm)
}

function mergeModelConfig(
  providerID: string,
  providerConfig: Config.Provider | undefined,
  modelID: string,
  baseModel: Model | undefined,
  modelConfig: NonNullable<Config.Provider["models"]>[string] | undefined,
) {
  const base = baseModel
    ? structuredClone(baseModel)
    : createBaseModelFromConfig(providerID, providerConfig, modelID, modelConfig ?? {})

  if (!modelConfig) {
    return {
      ...base,
      providerID,
      api: {
        ...base.api,
        url: mergeModelApiURL(providerID, providerConfig, base, undefined) ?? "",
        npm: mergeModelNpmPackage(providerID, providerConfig, base, undefined) ?? OPENAI_SDK_PACKAGE,
      },
    }
  }

  return {
    ...base,
    id: modelID,
    providerID,
    api: {
      id: firstNonEmptyString(modelConfig.id, base.api.id, modelID) ?? modelID,
      url: mergeModelApiURL(providerID, providerConfig, base, modelConfig) ?? "",
      npm: mergeModelNpmPackage(providerID, providerConfig, base, modelConfig) ?? OPENAI_SDK_PACKAGE,
    },
    name: firstNonEmptyString(modelConfig.name, base.name, modelID) ?? modelID,
    family: modelConfig.family ?? base.family,
    capabilities: {
      temperature: modelConfig.temperature ?? base.capabilities.temperature,
      reasoning: modelConfig.reasoning ?? base.capabilities.reasoning,
      replayAssistantReasoning:
        modelConfig.replay_assistant_reasoning ?? base.capabilities.replayAssistantReasoning,
      attachment: modelConfig.attachment ?? base.capabilities.attachment,
      toolcall: modelConfig.tool_call ?? base.capabilities.toolcall,
      input: {
        text: modelConfig.modalities?.input?.includes("text") ?? base.capabilities.input.text,
        audio: modelConfig.modalities?.input?.includes("audio") ?? base.capabilities.input.audio,
        image: modelConfig.modalities?.input?.includes("image") ?? base.capabilities.input.image,
        video: modelConfig.modalities?.input?.includes("video") ?? base.capabilities.input.video,
        pdf: modelConfig.modalities?.input?.includes("pdf") ?? base.capabilities.input.pdf,
      },
      output: {
        text: modelConfig.modalities?.output?.includes("text") ?? base.capabilities.output.text,
        audio: modelConfig.modalities?.output?.includes("audio") ?? base.capabilities.output.audio,
        image: modelConfig.modalities?.output?.includes("image") ?? base.capabilities.output.image,
        video: modelConfig.modalities?.output?.includes("video") ?? base.capabilities.output.video,
        pdf: modelConfig.modalities?.output?.includes("pdf") ?? base.capabilities.output.pdf,
      },
      interleaved: modelConfig.interleaved ?? base.capabilities.interleaved,
    },
    cost: {
      input: modelConfig.cost?.input ?? base.cost.input,
      output: modelConfig.cost?.output ?? base.cost.output,
      cache: {
        read: modelConfig.cost?.cache_read ?? base.cost.cache.read,
        write: modelConfig.cost?.cache_write ?? base.cost.cache.write,
      },
      experimentalOver200K: modelConfig.cost?.context_over_200k
        ? {
            input: modelConfig.cost.context_over_200k.input,
            output: modelConfig.cost.context_over_200k.output,
            cache: {
              read: modelConfig.cost.context_over_200k.cache_read ?? 0,
              write: modelConfig.cost.context_over_200k.cache_write ?? 0,
            },
          }
        : base.cost.experimentalOver200K,
    },
    limit: {
      context: modelConfig.limit?.context ?? base.limit.context,
      input: modelConfig.limit?.input ?? base.limit.input,
      output: modelConfig.limit?.output ?? base.limit.output,
    },
    status: modelConfig.status ?? base.status,
    options: {
      ...base.options,
      ...(modelConfig.options ?? {}),
    },
    headers: {
      ...base.headers,
      ...(modelConfig.headers ?? {}),
    },
    release_date: modelConfig.release_date ?? base.release_date,
    variants: modelConfig.variants ?? base.variants,
  } satisfies Model
}

function mergeProviderModels(
  providerID: string,
  baseModels: Record<string, Model>,
  providerConfig: Config.Provider | undefined,
) {
  // 先以 catalog 里的模型为底，再叠加项目配置里的 override / 自定义模型。
  const resultModels: Record<string, Model> = {}
  const configModels = providerConfig?.models ?? {}

  for (const [modelID, baseModel] of Object.entries(baseModels)) {
    resultModels[modelID] = mergeModelConfig(providerID, providerConfig, modelID, baseModel, configModels[modelID])
  }

  for (const [modelID, modelConfig] of Object.entries(configModels)) {
    if (resultModels[modelID]) continue
    resultModels[modelID] = mergeModelConfig(providerID, providerConfig, modelID, undefined, modelConfig)
  }

  return resultModels
}

// provider 级别的 whitelist / blacklist 在所有模型合并完成后再统一过滤。
function filterProviderModels(models: Record<string, Model>, providerConfig: Config.Provider | undefined) {
  let modelEntries = Object.entries(models)

  if (providerConfig?.whitelist?.length) {
    const whitelist = new Set(providerConfig.whitelist)
    modelEntries = modelEntries.filter(([modelID]) => whitelist.has(modelID))
  }

  if (providerConfig?.blacklist?.length) {
    const blacklist = new Set(providerConfig.blacklist)
    modelEntries = modelEntries.filter(([modelID]) => !blacklist.has(modelID))
  }

  return Object.fromEntries(modelEntries)
}

function toRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string")
}

function hasAny(values: string[], candidates: string[]) {
  const normalized = new Set(values.map((item) => item.toLowerCase()))
  return candidates.some((candidate) => normalized.has(candidate))
}

function readNestedBoolean(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "boolean") return value
  }
  return undefined
}

function readAnyboxModelBoolean(
  model: Record<string, unknown>,
  capabilities: Record<string, unknown>,
  keys: string[],
) {
  return readNestedBoolean(model, keys) ?? readNestedBoolean(capabilities, keys)
}

function normalizeAnyboxModelStatus(value: unknown): Model["status"] {
  if (value === "alpha" || value === "beta" || value === "deprecated" || value === "active") return value
  return "active"
}

function readAnyboxModelProviderSettings(item: Record<string, unknown>) {
  const provider = toRecord(item.provider)
  return {
    npm: firstNonEmptyString(
      provider.npm,
      provider.sdk,
      provider.sdkPackage,
      provider.sdk_package,
      provider.package,
      item.provider_npm,
      item.providerNpm,
      item.sdk,
      item.sdkPackage,
      item.sdk_package,
      item.npm,
      sdkPackageFromAnyboxType(provider.type),
      sdkPackageFromAnyboxType(provider.api_type),
      sdkPackageFromAnyboxType(provider.apiType),
      sdkPackageFromAnyboxType(provider.sdk_type),
      sdkPackageFromAnyboxType(provider.sdkType),
      sdkPackageFromAnyboxType(item.provider_type),
      sdkPackageFromAnyboxType(item.providerType),
      sdkPackageFromAnyboxType(item.api_type),
      sdkPackageFromAnyboxType(item.apiType),
      sdkPackageFromAnyboxType(item.sdk_type),
      sdkPackageFromAnyboxType(item.sdkType),
      sdkPackageFromAnyboxType(item.type),
    ),
  }
}

function readAnyboxModelEndpoint(item: Record<string, unknown>) {
  const provider = toRecord(item.provider)
  return firstNonEmptyString(
    item.endpoint,
    item.api_endpoint,
    item.apiEndpoint,
    item.chat_endpoint,
    item.chatEndpoint,
    provider.endpoint,
    provider.api_endpoint,
    provider.apiEndpoint,
    provider.chat_endpoint,
    provider.chatEndpoint,
  )
}

function buildAnyboxModelEndpointURL(baseURL: string, endpoint: string) {
  const root = normalizeAnyboxRootURL(baseURL)
  try {
    return new URL(endpoint.replace(/^\/+/, ""), `${root}/`).toString()
  } catch {
    throw new AnyboxModelCatalogError(`Anybox model endpoint '${endpoint}' is not a valid URL path`)
  }
}

function anyboxModelFromPayload(baseURL: string, payload: unknown): Model | undefined {
  const item = toRecord(payload)
  const modelID = firstNonEmptyString(item.id, item.model, item.slug)
  if (!modelID) return undefined

  const providerSettings = readAnyboxModelProviderSettings(item)
  const endpoint = readAnyboxModelEndpoint(item)
  if (!providerSettings.npm) {
    throw new AnyboxModelCatalogError(`Anybox model '${modelID}' is missing required sdk information`)
  }
  if (!endpoint) {
    throw new AnyboxModelCatalogError(`Anybox model '${modelID}' is missing required endpoint`)
  }

  const capabilities = toRecord(item.capabilities)
  const modalities = toRecord(item.modalities)
  const inputModalities = stringArray(modalities.input)
  const outputModalities = stringArray(modalities.output)
  const capabilityInput = stringArray(capabilities.input)
  const capabilityOutput = stringArray(capabilities.output)
  const inputKinds = [...inputModalities, ...capabilityInput]
  const outputKinds = [...outputModalities, ...capabilityOutput]
  const supportsVision =
    readAnyboxModelBoolean(item, capabilities, ["vision", "supportsVision", "image", "images"]) ??
    hasAny(inputKinds, ["image", "vision"])
  const supportsPdf =
    readAnyboxModelBoolean(item, capabilities, ["pdf", "supportsPdf", "supportsPDF"]) ??
    hasAny(inputKinds, ["pdf"])
  const supportsReasoning =
    readAnyboxModelBoolean(item, capabilities, ["reasoning", "supportsReasoning"]) ??
    false
  const supportsToolCall =
    readAnyboxModelBoolean(item, capabilities, ["tool_call", "toolCall", "toolcall", "tools", "function_calling"]) ??
    true

  return {
    id: modelID,
    providerID: ANYBOX_PROVIDER_ID,
    api: {
      id: firstNonEmptyString(item.api_id, item.apiID, item.model, modelID) ?? modelID,
      url: buildAnyboxModelEndpointURL(baseURL, endpoint),
      npm: providerSettings.npm,
    },
    name: firstNonEmptyString(item.display_name, item.displayName, item.name, modelID) ?? modelID,
    family: firstNonEmptyString(item.family, item.provider, item.vendor),
    capabilities: {
      temperature: readAnyboxModelBoolean(item, capabilities, ["temperature", "supportsTemperature"]) ?? true,
      reasoning: supportsReasoning,
      replayAssistantReasoning: true,
      attachment: supportsVision || supportsPdf,
      toolcall: supportsToolCall,
      input: {
        text: true,
        audio: hasAny(inputKinds, ["audio"]),
        image: supportsVision,
        video: hasAny(inputKinds, ["video"]),
        pdf: supportsPdf,
      },
      output: {
        text: true,
        audio: hasAny(outputKinds, ["audio"]),
        image:
          readAnyboxModelBoolean(item, capabilities, ["image_output", "imageOutput", "generatesImages"]) ??
          hasAny(outputKinds, ["image"]),
        video: hasAny(outputKinds, ["video"]),
        pdf: hasAny(outputKinds, ["pdf"]),
      },
      interleaved: item.interleaved === true ? true : false,
    },
    cost: {
      input: parseNumeric(toRecord(item.cost).input) ?? parseNumeric(toRecord(item.pricing).input) ?? 0,
      output: parseNumeric(toRecord(item.cost).output) ?? parseNumeric(toRecord(item.pricing).output) ?? 0,
      cache: {
        read: parseNumeric(toRecord(item.cost).cache_read) ?? parseNumeric(toRecord(item.pricing).cache_read) ?? 0,
        write: parseNumeric(toRecord(item.cost).cache_write) ?? parseNumeric(toRecord(item.pricing).cache_write) ?? 0,
      },
    },
    limit: {
      context:
        parseNumeric(item.context_window) ??
        parseNumeric(item.contextWindow) ??
        parseNumeric(toRecord(item.limit).context) ??
        128_000,
      input: parseNumeric(toRecord(item.limit).input),
      output:
        parseNumeric(item.output_limit) ??
        parseNumeric(item.outputLimit) ??
        parseNumeric(item.max_output_tokens) ??
        parseNumeric(item.maxOutputTokens) ??
        parseNumeric(toRecord(item.limit).output) ??
        8_192,
    },
    status: normalizeAnyboxModelStatus(item.status),
    options: toRecord(item.options),
    headers: {},
    release_date: firstNonEmptyString(item.release_date, item.releaseDate) ?? "2026-01-01",
    variants: {},
  }
}

async function fetchAnyboxModels(baseURL: string | undefined, accessToken: string) {
  const apiURL = normalizeAnyboxApiURL(baseURL)
  const modelsURL = buildProviderModelsURL(apiURL)
  const response = await AnyboxHTTP.anyboxFetch(modelsURL, {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${accessToken}`,
    },
    signal: AbortSignal.timeout(PROVIDER_VALIDATION_TIMEOUT_MS),
  })

  if (!response.ok) {
    const detail = await readValidationFailureMessage(response)
    throw new AnyboxHTTP.AnyboxHTTPError(
      "http_error",
      formatValidationFailureMessage(createAnyboxProvider(), response.status, detail),
      await AnyboxHTTP.createAnyboxDiagnostics(modelsURL),
    )
  }

  const payload = await response.json() as unknown
  const payloadRecord = toRecord(payload)
  const records: unknown[] = Array.isArray(payload)
    ? payload
    : Array.isArray(payloadRecord.data)
      ? payloadRecord.data
      : []
  const models = records
    .map((item) => anyboxModelFromPayload(apiURL, item))
    .filter((item): item is Model => Boolean(item))

  return Object.fromEntries(models.map((model) => [model.id, model]))
}

// 把 catalog 里的 provider、项目配置、当前实例环境变量三份信息合成最终 ProviderInfo。
function displayBaseURL(baseProvider: ProviderInfo | undefined, providerConfig: Config.Provider | undefined) {
  const catalogModel = baseProvider ? Object.values(baseProvider.models)[0] : undefined
  return firstNonEmptyString(providerConfig?.options?.baseURL, providerConfig?.api, baseProvider?.displayBaseURL, catalogModel?.api.url)
}

function hasExplicitAnyboxBaseURL(providerConfig: Config.Provider | undefined) {
  return Boolean(firstNonEmptyString(providerConfig?.options?.baseURL, providerConfig?.api))
}

async function applyProviderConfig(
  providerID: string,
  baseProvider: ProviderInfo | undefined,
  providerConfig: Config.Provider | undefined,
  env: Record<string, string | undefined>,
  authOptions?: ProviderAuth.ProviderRuntimeAuthOptions,
) {
  if (!baseProvider && !providerConfig) return undefined

  const provider: ProviderInfo = baseProvider
    ? structuredClone(baseProvider)
    : createConfigOnlyProvider(providerID, providerConfig)
  const configuredBaseURL =
    providerID === ANYBOX_PROVIDER_ID
      ? normalizeAnyboxApiURL(displayBaseURL(baseProvider, providerConfig))
      : displayBaseURL(baseProvider, providerConfig)
  const authProviderBaseURL =
    providerID === ANYBOX_PROVIDER_ID && !hasExplicitAnyboxBaseURL(providerConfig)
      ? undefined
      : configuredBaseURL

  const runtimeAuth = await ProviderAuth.resolveProviderRuntimeAuth(providerID, {
    configApiKey: providerConfig?.options?.apiKey,
    envApiKey: firstNonEmptyString(...provider.env.map((item) => env[item])),
    providerBaseURL: authProviderBaseURL,
  }, authOptions)

  const configured = Boolean(providerConfig) || Boolean(runtimeAuth.apiKey) || runtimeAuth.authState.status !== "not_connected"
  if (!configured) return undefined

  const effectiveBaseURL =
    providerID === ANYBOX_PROVIDER_ID
      ? runtimeAuth.runtimeBaseURL ?? configuredBaseURL
      : configuredBaseURL

  provider.name = providerConfig?.name ?? provider.name
  provider.env = providerConfig?.env ?? provider.env
  provider.source = providerConfig ? "config" : runtimeAuth.credentialSource === "environment" ? "env" : provider.source
  provider.key = runtimeAuth.apiKey
  provider.options = sanitizeProviderOptions(providerConfig?.options)
  if (providerID === ANYBOX_PROVIDER_ID) {
    provider.options = {
      ...provider.options,
      baseURL: effectiveBaseURL,
    }
  }
  provider.displayBaseURL = effectiveBaseURL
  provider.runtimeBaseURL = runtimeAuth.runtimeBaseURL
  provider.runtimeHeaders = runtimeAuth.runtimeHeaders
  provider.credentialKind = runtimeAuth.credentialKind
  provider.credentialSource = runtimeAuth.credentialSource
  provider.activeMethod = runtimeAuth.activeMethod ?? undefined
  provider.authCapabilities = runtimeAuth.authCapabilities
  provider.authState = runtimeAuth.authState

  let baseModels = provider.models
  if (runtimeAuth.authMode === "codex" && providerID === OPENAI_PROVIDER_ID) {
    baseModels = await fetchOpenAICodexModels(runtimeAuth).catch((error) => {
      log.warn("openai-codex-model-list-failed", {
        providerID,
        message: error instanceof Error ? error.message : String(error),
      })
      return openAICodexModels()
    })
  }
  if (providerID === ANYBOX_PROVIDER_ID && runtimeAuth.apiKey) {
    baseModels = await fetchAnyboxModels(effectiveBaseURL, runtimeAuth.apiKey).catch((error) => {
      if (error instanceof AnyboxModelCatalogError) {
        throw error
      }
      log.warn("anybox-model-list-failed", {
        providerID,
        message: error instanceof Error ? error.message : String(error),
      })
      return provider.models
    })
  }
  const mergeConfig =
    providerID === ANYBOX_PROVIDER_ID && providerConfig
      ? {
          ...providerConfig,
          api: effectiveBaseURL,
          options: {
            ...sanitizeProviderOptions(providerConfig.options),
            baseURL: effectiveBaseURL,
          },
        }
      : providerConfig
  provider.models = filterProviderModels(mergeProviderModels(providerID, baseModels, mergeConfig), providerConfig)
  return provider
}

async function catalogMap():Promise<Record<string,ProviderInfo>> {
  const providers = await providerRuntimeDependencies.getModelsDev()
  return {
    ...mapValues(providers, fromModelsDevProvider),
    [ANYBOX_PROVIDER_ID]: createAnyboxProvider(),
  }
}

/**
 * 解析“当前项目实际生效”的 provider 视图。
 *
 * 执行顺序：
 * 1. 先读取共享的 models.dev catalog，得到系统已知的 provider 基础骨架。
 * 2. 再读取当前项目配置，拿到 provider 开关、覆盖项和自定义项。
 * 3. 最后结合当前环境变量，把 catalog、config、env 合并成当前项目真正可用的 provider 集合。
 *
 * 返回值同时保留两个视图：
 * - `catalog`：完整的基础 provider 目录，适合“展示全集”。
 * - `providers`：当前项目中真正生效的 provider，适合“运行时使用”。
 */
async function resolveProjectProviders(configID = resolveConfigID()) {
  // 读取共享 catalog。这里提供“系统已知”的 provider 基础骨架。
  const catalog = await catalogMap()
  // 读取当前项目配置，里面可能会覆盖 provider 名称、模型、开关等。
  const config = await providerRuntimeDependencies.getConfig(configID)
  const globalConfig = configID === Config.GLOBAL_CONFIG_ID
    ? config
    : await providerRuntimeDependencies.getConfig(Config.GLOBAL_CONFIG_ID)
  const inheritedCustomProviderConfigs = Object.fromEntries(
    Object.entries(globalConfig.provider ?? {}).filter(([, providerConfig]) => isCustomProviderConfig(providerConfig)),
  )
  // 读取当前实例环境变量，用于补全 API Key 等运行时字段。
  const env = providerRuntimeDependencies.getEnvAll()

  // 候选 provider ID 来自两个地方：
  // 1. catalog 中已有的 provider
  // 2. config.provider 中额外声明的 provider（例如项目自定义 provider）
  //
  // 用 Set 合并是为了去重，避免同一个 provider 被重复处理。
  const providerIDs = new Set<string>([
    ...Object.keys(catalog),
    ...Object.keys(inheritedCustomProviderConfigs),
    ...Object.keys(config.provider ?? {}),
  ])

  // 这里只收集最终“在当前项目中生效”的 provider。
  // 未通过开关过滤，或无法形成有效配置的 provider，不会进入这个结果。
  const configuredProviders: Record<string, ProviderInfo> = {}
  for (const providerID of providerIDs) {
    // 先检查 provider 是否被 enabled / disabled 规则排除。
    if (!isProviderAllowed(config, providerID)) continue

    // 只有配置里显式声明了该 provider，才读取它的项目级配置；
    // 否则保持 undefined，让后面的合并逻辑只依赖 catalog 和 env。
    const providerConfig = hasProviderConfig(config, providerID)
      ? Config.mergeProviderConfig(inheritedCustomProviderConfigs[providerID], config.provider![providerID]!)
      : inheritedCustomProviderConfigs[providerID]

    // 按优先级合并基础 catalog、项目配置和环境变量：
    // - catalog 提供默认骨架
    // - project config 提供覆盖和追加
    // - env 提供 API Key 等敏感信息
    const provider = await applyProviderConfig(providerID, catalog[providerID], providerConfig, env)

    // 返回 undefined 说明这个 provider 虽然在候选集合里，
    // 但在当前上下文中并没有形成一个“已配置完成”的结果。
    if (!provider) continue

    // 记录最终结果，后续会用它来列出 provider、查 model、初始化 SDK。
    configuredProviders[providerID] = provider
  }

  // 同时返回原始 catalog 和当前项目已生效的 provider 视图。
  return {
    catalog,
    config,
    env,
    providers: configuredProviders,
  }
}

// -----------------------------------------------------------------------------
// 第二阶段：当前项目 provider 视图 -> 对外查询 API
// -----------------------------------------------------------------------------

function sortProviders<T extends { name: string; id: string }>(items: T[]) {
  return items.toSorted((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
}

function sortModels<T extends { name: string; id: string; providerID?: string }>(items: T[]) {
  return items.toSorted(
    (left, right) =>
      left.name.localeCompare(right.name) ||
      (left.providerID ?? "").localeCompare(right.providerID ?? "") ||
      left.id.localeCompare(right.id),
  )
}

function modelBaseURL(provider: ProviderInfo) {
  return firstNonEmptyString(provider.displayBaseURL, provider.options.baseURL)
}

function sdkBaseURL(provider: ProviderInfo, model: Model) {
  if (provider.id === ANYBOX_PROVIDER_ID) {
    return firstNonEmptyString(model.api.url, provider.runtimeBaseURL, provider.options.baseURL)
  }

  return firstNonEmptyString(provider.runtimeBaseURL, provider.options.baseURL, model.api.url)
}

function normalizeBaseURL(baseURL: string) {
  return baseURL.endsWith("/") ? baseURL : `${baseURL}/`
}

function buildProviderModelsURL(baseURL: string) {
  try {
    return new URL("models", normalizeBaseURL(baseURL)).toString()
  } catch {
    throw new Error(`Provider base URL '${baseURL}' is not a valid URL`)
  }
}

function pickValidationModel(provider: ProviderInfo) {
  return Object.values(provider.models)[0]
}

function extractValidationErrorMessage(payload: unknown): string | undefined {
  if (typeof payload === "string") {
    const trimmed = payload.trim()
    return trimmed || undefined
  }

  if (!payload || typeof payload !== "object") return undefined

  const record = payload as Record<string, unknown>
  const directCode = firstNonEmptyString(record.code, record.error_code)
  if (directCode === "model_gateway_disabled") {
    return "当前 workspace 没有模型网关权限。请在管理后台启用模型网关权益后重试。"
  }
  const directMessage = firstNonEmptyString(record.message, record.detail, record.error_description)
  if (directMessage) return directMessage

  const errorRecord = record.error
  if (errorRecord && typeof errorRecord === "object") {
    const nestedCode = firstNonEmptyString(
      (errorRecord as Record<string, unknown>).code,
      (errorRecord as Record<string, unknown>).error_code,
    )
    if (nestedCode === "model_gateway_disabled") {
      return "当前 workspace 没有模型网关权限。请在管理后台启用模型网关权益后重试。"
    }
    return firstNonEmptyString(
      (errorRecord as Record<string, unknown>).message,
      (errorRecord as Record<string, unknown>).detail,
      (errorRecord as Record<string, unknown>).error,
    )
  }

  return undefined
}

type EntitlementFailureResponse = {
  status: number
  headers: Pick<Headers, "get">
  json: () => Promise<unknown>
}

async function readEntitlementFailureMessage(response: EntitlementFailureResponse) {
  if (response.status !== 403) return undefined
  const contentType = response.headers.get("content-type") ?? ""
  if (!contentType.includes("application/json")) return undefined
  const payload = await response.json().catch(() => undefined)
  const detail = extractValidationErrorMessage(payload)
  return detail?.includes("模型网关权限") ? detail : undefined
}

function runtimeFetchInputURL(input: RuntimeFetchInput) {
  if (typeof input === "string") return input
  if (input instanceof URL) return input.toString()
  return input.url
}

async function readValidationFailureMessage(response: Response) {
  const contentType = response.headers.get("content-type") ?? ""

  if (contentType.includes("application/json")) {
    const payload = await response.json().catch(() => undefined)
    const parsed = extractValidationErrorMessage(payload)
    if (parsed) return parsed
  }

  const text = await response.text().catch(() => "")
  return extractValidationErrorMessage(text)
}

function formatValidationFailureMessage(provider: ProviderInfo, status: number, detail?: string) {
  const summary = status === 401 || status === 403 ? "rejected the API key" : "validation request failed"
  return detail
    ? `Provider '${provider.name}' ${summary} (${status}): ${detail}`
    : `Provider '${provider.name}' ${summary} (${status})`
}

function toPublicModel(provider: ProviderInfo, model: Model): PublicModel {
  return {
    ...model,
    providerName: provider.name,
    available: isAvailable(provider),
  }
}

function toPublicProvider(provider: ProviderInfo): PublicProvider {
  const models = sortModels(Object.values(provider.models).map((model) => toPublicModel(provider, model)))
  return {
    id: provider.id,
    name: provider.name,
    source: provider.source,
    env: provider.env,
    configured: true,
    isCustomProvider: isCustomProvider(provider),
    available: isAvailable(provider),
    apiKeyConfigured: hasApiKeyCredential(provider),
    baseURL: modelBaseURL(provider),
    customChatEndpoint: getCustomProviderChatEndpoint(provider),
    customDefaultModel: getCustomProviderDefaultModel(provider),
    modelCount: models.length,
    authCapabilities: provider.authCapabilities ?? getCapabilitiesFallback(provider.id),
    authState: provider.authState ?? createFallbackAuthState(provider.id),
    authScope: "global",
    activeAuthMethod: provider.authState?.activeMethod,
    connectionLabel: provider.authState?.connectionLabel,
    lastAuthError: provider.authState?.lastError,
    models,
  }
}

function toCatalogItem(
  baseProvider: ProviderInfo,
  configuredProvider: ProviderInfo | undefined,
  authState: ProviderAuth.ProviderAuthState,
): ProviderCatalogItem {
  const provider = configuredProvider ?? baseProvider
  return {
    id: baseProvider.id,
    name: configuredProvider?.name ?? baseProvider.name,
    source: configuredProvider?.source ?? baseProvider.source,
    env: configuredProvider?.env ?? baseProvider.env,
    configured: Boolean(configuredProvider),
    isCustomProvider: isCustomProvider(configuredProvider ?? baseProvider),
    available: configuredProvider
      ? isAvailable(configuredProvider)
      : baseProvider.id === ANYBOX_PROVIDER_ID
        ? authState.status === "connected"
        : baseProvider.env.length === 0,
    apiKeyConfigured: configuredProvider ? hasApiKeyCredential(configuredProvider) : false,
    baseURL: configuredProvider ? modelBaseURL(configuredProvider) : modelBaseURL(baseProvider),
    customChatEndpoint: getCustomProviderChatEndpoint(provider),
    customDefaultModel: getCustomProviderDefaultModel(provider),
    modelCount: Object.keys(provider.models).length,
    authCapabilities: configuredProvider?.authCapabilities ?? authState.capabilities,
    authState,
    authScope: "global",
    activeAuthMethod: authState.activeMethod,
    connectionLabel: authState.connectionLabel,
    lastAuthError: authState.lastError,
  }
}

// 运行时缓存 key。
// 只要这里参与计算的字段发生变化，就会重新创建 SDK / LanguageModel。

function runtimeKey(provider: ProviderInfo, model: Model) {
  return JSON.stringify({
    providerID: provider.id,
    modelID: model.id,
    sdkPackage: model.api.npm,
    apiKey: provider.key ?? "",
    baseURL: sdkBaseURL(provider, model) ?? "",
    headers: {
      ...provider.runtimeHeaders,
      ...model.headers,
    },
    customProvider: provider.options.customProvider === true,
    customAuthHeaderName: provider.options.customAuthHeaderName ?? "",
    customChatEndpoint: provider.options.customChatEndpoint ?? "",
  })
}

async function requireRuntimeProvider(providerID: string, configID = resolveConfigID()) {
  const provider = await getProvider(providerID, configID)
  if (provider) return provider

  throw new InitError({
    providerID,
  })
}

export async function catalog(configID = resolveConfigID()) {
  const state = await resolveProjectProviders(configID)
  const providerIDs = new Set([
    ...Object.keys(state.catalog),
    ...Object.keys(state.providers),
  ])
  const items = await Promise.all(
    [...providerIDs].map(async (providerID) => {
      const provider = state.catalog[providerID] ?? state.providers[providerID]
      if (!provider) {
        throw new Error(`Provider '${providerID}' could not be resolved from catalog or configured providers`)
      }
      const configuredProvider = state.providers[provider.id]
      const authState =
        configuredProvider?.authState ??
        (await ProviderAuth.getProviderAuthState(provider.id, {
          configApiKey: state.config.provider?.[provider.id]?.options?.apiKey,
          envApiKey: firstNonEmptyString(...(configuredProvider?.env ?? provider.env).map((item) => state.env[item])),
          providerBaseURL: displayBaseURL(provider, state.config.provider?.[provider.id]),
        }))
      return toCatalogItem(provider, configuredProvider, authState)
    }),
  )
  return sortProviders(items)
}

export type ProviderValidationOptions = {
  auth?: ProviderAuth.ProviderRuntimeAuthOptions
  requireCredential?: boolean
}

export async function validateProviderConfig(
  providerID: string,
  providerConfig: Config.Provider,
  configID = Config.GLOBAL_CONFIG_ID,
  options: ProviderValidationOptions = {},
) {
  const [catalog, config] = await Promise.all([catalogMap(), providerRuntimeDependencies.getConfig(configID)])
  const mergedProviderConfig = Config.mergeProviderConfig(config.provider?.[providerID], providerConfig)
  const provider = await applyProviderConfig(
    providerID,
    catalog[providerID],
    mergedProviderConfig,
    providerRuntimeDependencies.getEnvAll(),
    options.auth,
  )

  if (!provider) {
    throw new Error(`Provider '${providerID}' could not be resolved from the catalog`)
  }

  if (providerID === ANYBOX_PROVIDER_ID && !provider.key) {
    if (options.requireCredential) {
      throw new Error(`Provider '${provider.name}' does not have an available Anybox account session`)
    }
    return
  }

  if (!provider.key && provider.env.length > 0) {
    if (options.requireCredential) {
      throw new Error(`Provider '${provider.name}' does not have an available credential for the selected connection method`)
    }
    return
  }

  if (provider.activeMethod && isOpenAIChatGPTMethod(provider.activeMethod)) {
    return
  }

  if (options.requireCredential && provider.activeMethod === "api-key" && !provider.key) {
    throw new Error(`Provider '${provider.name}' does not have an available API key for the selected connection method`)
  }

  if (providerID === ANYBOX_PROVIDER_ID) {
    if (!provider.key) return
    const baseURL = firstNonEmptyString(provider.runtimeBaseURL, provider.options.baseURL, provider.displayBaseURL)
    if (!baseURL) return
    await fetchAnyboxModels(baseURL, provider.key)
    return
  }

  const model = pickValidationModel(provider)
  const baseURL = firstNonEmptyString(provider.runtimeBaseURL, provider.options.baseURL, model?.api.url)
  if (!baseURL) {
    return
  }

  const headers = new Headers({
    accept: "application/json",
  })

  if (provider.key) {
    headers.set("authorization", `Bearer ${provider.key}`)
  }

  for (const [key, value] of Object.entries(provider.runtimeHeaders ?? {})) {
    headers.set(key, value)
  }

  for (const [key, value] of Object.entries(model?.headers ?? {})) {
    headers.set(key, value)
  }

  const modelsURL = buildProviderModelsURL(baseURL)

  let response: Response
  try {
    response = await fetch(modelsURL, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(PROVIDER_VALIDATION_TIMEOUT_MS),
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Could not reach ${provider.name} at ${modelsURL}: ${detail}`)
  }

  if (!response.ok) {
    const detail = await readValidationFailureMessage(response)
    throw new Error(formatValidationFailureMessage(provider, response.status, detail))
  }
}

async function list(configID = resolveConfigID()) {
  const state = await resolveProjectProviders(configID)
  return state.providers
}

export async function listPublicProviders(configID = resolveConfigID()) {
  const providers = await list(configID)
  return sortProviders(Object.values(providers).map(toPublicProvider))
}

export async function listModels(configID = resolveConfigID()) {
  if (providerFunctionOverrides.listModels) {
    return providerFunctionOverrides.listModels(configID)
  }

  const registry = await import("#model/registry.ts")
  return registry.listAISDKModels(configID)
}

export async function listProviderSourceModels(configID = resolveConfigID()) {
  if (providerFunctionOverrides.listModels) {
    return providerFunctionOverrides.listModels(configID)
  }

  const providers = await list(configID)
  return sortModels(
    Object.values(providers).flatMap((provider) => Object.values(provider.models).map((model) => toPublicModel(provider, model))),
  )
}

export async function listProviderCatalogSourceModels(configID = resolveConfigID()) {
  if (providerFunctionOverrides.listModels) {
    return providerFunctionOverrides.listModels(configID)
  }

  const state = await resolveProjectProviders(configID)
  const providerIDs = new Set([
    ...Object.keys(state.catalog),
    ...Object.keys(state.providers),
  ])

  return sortModels(
    [...providerIDs].flatMap((providerID) => {
      const provider = state.providers[providerID] ?? state.catalog[providerID]
      if (!provider) return []
      return Object.values(provider.models).map((model) => toPublicModel(provider, model))
    }),
  )
}

async function getProvider(providerID: string, configID = resolveConfigID()) {
  const providers = await list(configID)
  return providers[providerID]
}

export async function getPublicProvider(providerID: string, configID = resolveConfigID()) {
  const provider = await getProvider(providerID, configID)
  if (!provider) return undefined
  return toPublicProvider(provider)
}

async function getModel(providerID: string, modelID: string, configID = resolveConfigID()) {
  if (providerFunctionOverrides.getModel) {
    return providerFunctionOverrides.getModel(providerID, modelID, configID)
  }

  const registry = await import("#model/registry.ts")
  return registry.getAISDKModel(providerID, modelID, configID)
}

export async function getProviderSourceModel(providerID: string, modelID: string, configID = resolveConfigID()) {
  if (providerFunctionOverrides.getModel) {
    return providerFunctionOverrides.getModel(providerID, modelID, configID)
  }

  const providers = await list(configID)
  const provider = providers[providerID]
  if (!provider) {
    throw new ModelNotFoundError({
      providerID,
      modelID,
      suggestions: suggestMatches(providerID, Object.keys(providers)),
    })
  }

  const model = provider.models[modelID]
  if (!model) {
    throw new ModelNotFoundError({
      providerID,
      modelID,
      suggestions: suggestMatches(modelID, Object.keys(provider.models)),
    })
  }

  return model
}

export async function getSelection(configID = resolveConfigID()) {
  if (providerFunctionOverrides.getSelection) {
    return providerFunctionOverrides.getSelection(configID)
  }

  const config = await providerRuntimeDependencies.getConfig(configID)
  return {
    model: config.model,
    small_model: config.small_model,
    image_model: config.image_model,
    image_generation: config.image_generation,
    reasoning_effort: config.reasoning_effort,
  }
}

/**
 * 用三步解析默认模型：
 * 1. 如果配置里保存的 model 仍然有效，就直接使用它。
 * 2. 否则退回到“当前项目里第一个可用模型”。
 * 3. 如果连可用模型都没有，直接抛错，要求调用方显式配置 provider / model。
 */
export async function getDefaultModelRef(configID = resolveConfigID()): Promise<ModelReference> {
  if (providerFunctionOverrides.getDefaultModelRef) {
    return providerFunctionOverrides.getDefaultModelRef(configID)
  }

  const selection = await getSelection(configID)
  const globalSelection =
    configID === Config.GLOBAL_CONFIG_ID
      ? undefined
      : await getSelection(Config.GLOBAL_CONFIG_ID).catch(() => undefined)
  const modelCandidates = [selection.model, globalSelection?.model]

  for (const candidate of modelCandidates) {
    const parsed = parseModelReference(candidate)
    if (!parsed) continue
    try {
      await getModel(parsed.providerID, parsed.modelID, configID)
      return parsed
    } catch {
      // 配置里保存的是陈旧模型时，继续退回到当前可用模型。
    }
  }

  const models = await listModels(configID)
  const firstModel = models.find((model) => model.available)
  if (firstModel) {
    return {
      providerID: firstModel.providerID,
      modelID: firstModel.id,
    }
  }

  throw new Error(
    "No provider model is available for this project. Configure a provider/model in the project settings before starting a session.",
  )
}

export async function getDefaultImageModelRef(configID = Config.GLOBAL_CONFIG_ID): Promise<ModelReference> {
  const selection = await getSelection(configID)
  const parsed = parseModelReference(selection.image_model)
  if (!parsed) {
    throw new Error("No image generation model is configured. Choose an image-capable model in model settings before using generate_image.")
  }

  const model = await getModel(parsed.providerID, parsed.modelID, configID)
  if (!model.capabilities.output.image) {
    throw new Error(`Configured image model '${selection.image_model}' does not support image output.`)
  }

  return parsed
}

// -----------------------------------------------------------------------------
// 第三阶段：惰性运行时初始化
// 只有 session 真正要拿 LanguageModel 发请求时，才会进入这一层。
// -----------------------------------------------------------------------------

export async function getLanguage(model: Model, configID = resolveConfigID()): Promise<LanguageModel> {
  if (providerFunctionOverrides.getLanguage) {
    return providerFunctionOverrides.getLanguage(model, configID)
  }

  const provider = await requireRuntimeProvider(model.providerID, configID)

  const key = runtimeKey(provider, model)
  const cache = getLanguageState(configID)
  const cached = cache.get(key)
  if (cached) return cached

  const sdk = await getSDK(model, configID)
  const language = sdk.languageModel(model.api.id) as LanguageModel
  cache.set(key, language)
  return language
}

export async function getImage(model: Model, configID = Config.GLOBAL_CONFIG_ID): Promise<ImageModel> {
  const sdk = await getSDK(model, configID)
  if (typeof sdk.imageModel !== "function") {
    throw new Error(`Provider '${model.providerID}' does not expose image models through its SDK adapter.`)
  }
  return sdk.imageModel(model.api.id) as ImageModel
}

async function loadSDKFactory(npmPackage: string) {
  const adapter = await resolveSDKAdapter(npmPackage)
  const loaded = await providerRuntimeDependencies.importPackage(
    adapter.installPackage ?? npmPackage,
    adapter.version,
    adapter.importSpecifier ?? npmPackage,
  )
  const factory = resolveSDKFactory(npmPackage, adapter, loaded.module)

  return {
    adapter,
    factory: factory as SDKModuleFactory,
    version: loaded.version,
  }
}

type RuntimeFetchInput = any
type RuntimeFetchInit = any

function withBearerToken(input: RuntimeFetchInput, init: RuntimeFetchInit, accessToken: string) {
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
  headers.set("authorization", `Bearer ${accessToken}`)

  return {
    input: input instanceof Request ? input.clone() : input,
    init: {
      ...init,
      headers,
    },
  }
}

function createAnyboxRuntimeFetch(provider: ProviderInfo) {
  let accessToken = provider.key

  return async (input: RuntimeFetchInput, init?: RuntimeFetchInit) => {
    if (!accessToken) return await AnyboxHTTP.anyboxFetch(input, init)

    const firstRequest = withBearerToken(input, init, accessToken)
    const response = await AnyboxHTTP.anyboxFetch(firstRequest.input, firstRequest.init)
    const entitlementMessage = await readEntitlementFailureMessage(response.clone())
    if (entitlementMessage) {
      throw new AnyboxHTTP.AnyboxHTTPError(
        "http_error",
        entitlementMessage,
        await AnyboxHTTP.createAnyboxDiagnostics(runtimeFetchInputURL(firstRequest.input)),
      )
    }
    if (response.status !== 401) return response

    const refreshed = await ProviderAuth.resolveProviderRuntimeAuth(
      ANYBOX_PROVIDER_ID,
      {
        providerBaseURL: firstNonEmptyString(provider.runtimeBaseURL, provider.displayBaseURL, provider.options.baseURL),
      },
      {
        method: provider.activeMethod,
        credentialMode: "active",
        forceRefresh: true,
      },
    ).catch((error) => {
      log.warn("anybox-runtime-fetch-refresh-failed", {
        providerID: provider.id,
        message: error instanceof Error ? error.message : String(error),
      })
      return undefined
    })

    if (!refreshed?.apiKey || refreshed.apiKey === accessToken) return response

    accessToken = refreshed.apiKey
    provider.key = refreshed.apiKey
    provider.runtimeBaseURL = refreshed.runtimeBaseURL ?? provider.runtimeBaseURL
    provider.runtimeHeaders = refreshed.runtimeHeaders ?? provider.runtimeHeaders

    const retryRequest = withBearerToken(input, init, accessToken)
    const retryResponse = await AnyboxHTTP.anyboxFetch(retryRequest.input, retryRequest.init)
    const retryEntitlementMessage = await readEntitlementFailureMessage(retryResponse.clone())
    if (retryEntitlementMessage) {
      throw new AnyboxHTTP.AnyboxHTTPError(
        "http_error",
        retryEntitlementMessage,
        await AnyboxHTTP.createAnyboxDiagnostics(runtimeFetchInputURL(retryRequest.input)),
      )
    }
    return retryResponse
  }
}

function readCustomProviderHeaderName(provider: ProviderInfo) {
  const value = provider.options.customAuthHeaderName
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function readCustomProviderChatEndpoint(provider: ProviderInfo) {
  const value = provider.options.customChatEndpoint
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.startsWith("/") ? trimmed : undefined
}

function resolveRuntimeFetchURL(input: RuntimeFetchInput) {
  return new URL(runtimeFetchInputURL(input))
}

function replaceRuntimeFetchURL(input: RuntimeFetchInput, url: URL): RuntimeFetchInput {
  if (input instanceof Request) {
    return new Request(url.toString(), input as unknown as RequestInit)
  }
  if (input instanceof URL) {
    return url
  }
  if (typeof input === "string") {
    return url.toString()
  }
  return new Request(url.toString(), input)
}

function buildCustomRuntimeChatURL(baseURL: string | undefined, chatEndpoint: string | undefined) {
  if (!baseURL || !chatEndpoint) return undefined
  const url = new URL(baseURL)
  const basePath = url.pathname.replace(/\/+$/, "")
  url.pathname = `${basePath}${chatEndpoint}`.replace(/\/{2,}/g, "/")
  return url
}

function createCustomProviderRuntimeFetch(provider: ProviderInfo, baseURL: string | undefined) {
  const headerName = readCustomProviderHeaderName(provider)
  const chatURL = buildCustomRuntimeChatURL(baseURL, readCustomProviderChatEndpoint(provider))

  return async (input: RuntimeFetchInput, init?: RuntimeFetchInit) => {
    let nextInput = input

    if (chatURL) {
      const requestURL = resolveRuntimeFetchURL(input)
      if (requestURL.pathname.endsWith("/chat/completions")) {
        const nextURL = new URL(chatURL.toString())
        nextURL.search = requestURL.search
        nextInput = replaceRuntimeFetchURL(input, nextURL)
      }
    }

    const headers = new Headers(init?.headers ?? (nextInput instanceof Request ? nextInput.headers : input instanceof Request ? input.headers : undefined))
    if (headerName && provider.key) {
      headers.set(headerName, provider.key)
      if (headerName.toLowerCase() !== "authorization") {
        headers.delete("authorization")
      }
    }

    return fetch(nextInput, {
      ...init,
      headers,
    })
  }
}

async function getSDK(model: Model, configID = resolveConfigID()) {
  // SDK Provider 比 LanguageModel 更底层，先保证它存在，再由上层取 languageModel。
  const provider = await requireRuntimeProvider(model.providerID, configID)

  if (!provider.key && provider.env.length > 0) {
    throw new InitError(
      {
        providerID: model.providerID,
      },
      {
        cause: new Error(`Provider '${model.providerID}' is missing an API key`),
      },
    )
  }

  if (isCustomProvider(provider) && !provider.key) {
    throw new InitError(
      {
        providerID: model.providerID,
      },
      {
        cause: new Error(`Provider '${model.providerID}' is missing a custom authentication header value`),
      },
    )
  }

  const key = runtimeKey(provider, model)
  const cache = getSDKState(configID)
  const cached = cache.get(key)
  if (cached) return cached

  const baseURL = sdkBaseURL(provider, model)
  const combinedHeaders = {
    ...(provider.runtimeHeaders ?? {}),
    ...model.headers,
  }
  const headers = Object.keys(combinedHeaders).length > 0 ? combinedHeaders : undefined
  const runtimeFetch = provider.id === ANYBOX_PROVIDER_ID
    ? createAnyboxRuntimeFetch(provider)
    : isCustomProvider(provider)
      ? createCustomProviderRuntimeFetch(provider, baseURL)
      : undefined
  const sdkPackage = model.api.npm
  const loaded = await loadSDKFactory(sdkPackage)
  log.info("initializing sdk provider", {
    providerID: model.providerID,
    modelID: model.id,
    requestedSdkPackage: model.api.npm,
    sdkPackage,
    baseURL,
    apiKeyConfigured: Boolean(provider.key),
    headersConfigured: Boolean(headers),
  })
  const sdk = loaded.adapter.create(
    {
      provider,
      apiKey: isCustomProvider(provider) ? "custom-provider-key" : provider.key,
      baseURL,
      headers,
      fetch: runtimeFetch,
    },
    loaded.factory,
  )

  cache.set(key, sdk as SDKProvider)
  return sdk as SDKProvider
}

export async function getSDKProvider(model: Model, configID = resolveConfigID()) {
  return await getSDK(model, configID)
}

// -----------------------------------------------------------------------------
// models.dev catalog -> 内部统一 provider 结构
// -----------------------------------------------------------------------------

function fromModelsDevModel(provider: ModelsDev.DevProvider, model: ModelsDev.DevModel): Model {
  const sdkPackage = provider.id === DEEPSEEK_PROVIDER_ID
    ? DEEPSEEK_SDK_PACKAGE
    : firstNonEmptyString(model.provider?.npm, provider.npm) ?? OPENAI_SDK_PACKAGE

  return {
    id: model.id,
    providerID: provider.id,
    api: {
      id: model.id,
      url: firstNonEmptyString(model.provider?.api, provider.api) ?? "",
      npm: sdkPackage,
    },
    name: model.name,
    capabilities: {
      temperature: model.temperature,
      reasoning: model.reasoning,
      replayAssistantReasoning: model.replay_assistant_reasoning ?? true,
      attachment: model.attachment,
      toolcall: model.tool_call,
      input: {
        text: model.modalities?.input?.includes("text") ?? false,
        audio: model.modalities?.input?.includes("audio") ?? false,
        image: model.modalities?.input?.includes("image") ?? false,
        video: model.modalities?.input?.includes("video") ?? false,
        pdf: model.modalities?.input?.includes("pdf") ?? false,
      },
      output: {
        text: model.modalities?.output?.includes("text") ?? false,
        audio: model.modalities?.output?.includes("audio") ?? false,
        image: model.modalities?.output?.includes("image") ?? false,
        video: model.modalities?.output?.includes("video") ?? false,
        pdf: model.modalities?.output?.includes("pdf") ?? false,
      },
      interleaved: model.interleaved ?? false,
    },
    cost: {
      input: model.cost?.input ?? 0,
      output: model.cost?.output ?? 0,
      cache: {
        read: model.cost?.cache_read ?? 0,
        write: model.cost?.cache_write ?? 0,
      },
      experimentalOver200K: model.cost?.context_over_200k
        ? {
            cache: {
              read: model.cost.context_over_200k.cache_read ?? 0,
              write: model.cost.context_over_200k.cache_write ?? 0,
            },
            input: model.cost.context_over_200k.input,
            output: model.cost.context_over_200k.output,
          }
        : undefined,
    },
    limit: {
      context: model.limit.context,
      input: model.limit.input,
      output: model.limit.output,
    },
    status: model.status ?? "active",
    options: model.options ?? {},
    headers: model.headers ?? {},
    release_date: model.release_date,
    variants: model.variants ?? {},
    family: model.family,
  }
}

export function fromModelsDevProvider(provider: ModelsDev.DevProvider): ProviderInfo {
  return {
    id: provider.id,
    source: "api",
    name: provider.name,
    env: provider.env ?? [],
    options: {},
    models: mapValues(provider.models, (model) => fromModelsDevModel(provider, model)),
  }
}

export const ModelNotFoundError = NamedError.create(
  "ProviderModelNotFoundError",
  z.object({
    providerID: z.string(),
    modelID: z.string(),
    suggestions: z.array(z.string()).optional(),
  }),
)

export const InitError = NamedError.create(
  "ProviderInitError",
  z.object({
    providerID: z.string(),
  }),
)



export {
  list,
  getProvider,
  getModel,
}
