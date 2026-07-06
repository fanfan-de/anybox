import { createHash } from "node:crypto"
import { readFile, readdir, stat } from "node:fs/promises"
import { basename, isAbsolute, join, relative, resolve } from "node:path"
import z from "zod"
import * as ProviderAuth from "#auth/provider-auth.ts"
import * as Config from "#config/config.ts"
import * as Connector from "#connector/connector.ts"
import * as Mcp from "#mcp/manager.ts"
import * as Plugin from "#plugin/plugin.ts"
import * as ModelsDev from "#provider/modelsdev.ts"
import * as AnyboxHTTP from "#provider/anybox-http.ts"
import * as ModelRegistry from "#model/registry.ts"
import * as ModelRuntime from "#model/runtime.ts"
import * as ModelSelection from "#model/selection.ts"
import type { Model } from "#model/types.ts"
import * as Provider from "#provider/provider.ts"
import * as ProviderTransform from "#provider/transform.ts"
import { ApiError } from "#server/error.ts"
import { clearProjectModelListCache } from "#server/usecases/model-list-cache.ts"
import * as PromptPresets from "#session/support/prompt-presets.ts"
import * as PromptUrlInstall from "#session/support/prompt-url-install.ts"
import * as SkillGitInstall from "#skill/git-install.ts"
import * as Skill from "#skill/skill.ts"
import * as SkillManager from "#skill/manage.ts"
import * as ToolRegistry from "#tool/registry.ts"
import * as Log from "#util/log.ts"

const log = Log.create({ service: "settings" })
const SKILL_FILENAME = "SKILL.md"
const PLUGIN_SKILLS_TREE_ROOT_PATH = "plugin-skills://installed"
const CUSTOM_PROVIDER_PREFIX = "custom-"
const CUSTOM_PROVIDER_SDK_PACKAGE = "@ai-sdk/openai-compatible"
const CUSTOM_PROVIDER_TEST_TIMEOUT_MS = 15_000

type GenerateTextFunction = typeof import("ai")["generateText"]

interface SettingsRuntimeDependencies {
  getGenerateText: () => Promise<GenerateTextFunction>
}

const defaultRuntimeDependencies: SettingsRuntimeDependencies = {
  getGenerateText: async () => (await import("ai")).generateText,
}

let runtimeDependencies = defaultRuntimeDependencies

export function setRuntimeDependenciesForTesting(overrides: Partial<SettingsRuntimeDependencies>) {
  const previousDependencies = runtimeDependencies
  runtimeDependencies = {
    ...runtimeDependencies,
    ...overrides,
  }

  return () => {
    runtimeDependencies = previousDependencies
  }
}

export const SkillFileQuery = z.object({
  path: z.string().min(1),
})

export const SkillFileBody = z.object({
  path: z.string().min(1),
  content: z.string(),
})

export const CreateSkillBody = z.object({
  name: z.string().min(1),
  parentDirectory: z.string().min(1).nullable().optional(),
})

export const RenameSkillBody = z.object({
  directory: z.string().min(1),
  name: z.string().min(1),
})

export const DeleteSkillQuery = z.object({
  directory: z.string().min(1),
})

export const CreateSkillFolderBody = z.object({
  name: z.string().min(1),
  parentDirectory: z.string().min(1).nullable().optional(),
})

export const RenameSkillFolderBody = z.object({
  directory: z.string().min(1),
  name: z.string().min(1),
})

export const DeleteSkillFolderQuery = z.object({
  directory: z.string().min(1),
})

export const MoveSkillDirectoryBody = z.object({
  directory: z.string().min(1),
  parentDirectory: z.string().min(1).nullable().optional(),
})

export const PreviewSkillGitInstallBody = z.object({
  source: z.string().min(1),
  parentDirectory: z.string().min(1).nullable().optional(),
})

export const InstallSkillGitPreviewBody = z.object({
  previewID: z.string().min(1),
  skillIDs: z.array(z.string().min(1)),
  parentDirectory: z.string().min(1).nullable().optional(),
})

export const InstallSkillLocalFileBody = z.object({
  sourcePath: z.string().min(1),
  parentDirectory: z.string().min(1).nullable().optional(),
})

export const UpdateMcpServerBody = Config.McpServerInput
export const UpdateGlobalProviderBody = Config.Provider
export const UpdateGlobalModelSelectionBody = Config.ModelSelection
const CustomProviderBodyBase = z.object({
  providerID: z.string().min(1).optional(),
  apiBaseURL: z.string().min(1),
  apiKey: z.string().optional(),
  authHeader: z.string().optional(),
  defaultModel: z.string().min(1),
  chatEndpoint: z.string().min(1),
})
const hasCustomProviderCredentialInput = (value: { providerID?: string; apiKey?: string; authHeader?: string }) =>
  Boolean(value.providerID?.trim() || value.apiKey?.trim() || value.authHeader?.trim())
export const UpsertCustomProviderBody = CustomProviderBodyBase.refine(hasCustomProviderCredentialInput, {
  path: ["apiKey"],
  message: "API key is required for new custom providers.",
})
export const TestCustomProviderConnectionBody = CustomProviderBodyBase.refine(hasCustomProviderCredentialInput, {
  path: ["apiKey"],
  message: "API key is required for new custom providers.",
})
export const PluginCatalogQuery = z.object({
  freshness: z.enum(["cached", "fresh"]).optional(),
})
export const InstallPluginBody = Plugin.InstallPluginInput
export const UpdateInstalledPluginBody = Plugin.UpdateInstalledPluginInput
export const ImportPluginURLBody = Plugin.ImportPluginURLInput
export const SavePluginConnectorApiKeyBody = Plugin.SavePluginConnectorApiKeyInput
export const SaveConnectorApiKeyBody = Connector.SaveConnectorApiKeyInput
export const SaveConnectorConfigBody = Connector.SaveConnectorConfigInput
export const PluginConnectorAuthFlowBody = z.object({}).optional()
export const ConnectorAuthFlowBody = z.object({}).optional()

export const ProviderAuthFlowBody = z.object({
  method: z.string().min(1),
  baseURL: z.string().nullable().optional(),
  prompt: z.enum(["login", "select_account"]).optional(),
})

export const ProviderAuthApiKeyBody = z.object({
  apiKey: z.string().nullable().optional(),
})

export const ProviderConnectionTestBody = z.object({
  method: z.string().optional(),
  credentialMode: z.enum(["active", "manual", "environment"]).optional(),
  apiKey: z.string().nullable().optional(),
  baseURL: z.string().nullable().optional(),
})

export const PromptPresetCreateBody = z.object({
  label: z.string().optional(),
  content: z.string().optional(),
  description: z.string().optional(),
})

export const PromptPresetBody = z.object({
  label: z.string().optional(),
  content: z.string(),
  description: z.string().optional(),
})

export const PromptPresetSelectionBody = z.object({
  systemPromptPresetID: z.string().min(1),
  planModePromptPresetID: z.string().min(1),
  sideChatPromptPresetID: z.string().min(1),
  gitCommitPromptPresetID: z.string().min(1),
})

export const PromptTranslationLanguageID = z.enum([
  "en",
  "zh-Hans",
  "zh-Hant",
  "es",
  "fr",
  "de",
  "pt",
  "it",
  "ja",
  "ko",
  "nl",
  "ru",
])

export const PromptPresetTranslationBody = z.object({
  sourcePresetID: z.string().optional(),
  sourceLabel: z.string().min(1),
  content: z.string().refine((value) => value.trim().length > 0, {
    message: "Prompt content must not be empty.",
  }),
  languageID: PromptTranslationLanguageID,
  model: z.string().min(1),
})

export const PreviewPromptUrlInstallBody = z.object({
  source: z.string().min(1),
})

export const InstallPromptUrlPreviewBody = z.object({
  previewID: z.string().min(1),
  promptIDs: z.array(z.string().min(1)),
})

export const UpdateBuiltinToolSelectionBody = z
  .object({
    tools: z.record(z.string(), z.boolean()),
  })
  .strict()

export const UpdateToolPermissionModeBody = z
  .object({
    mode: Config.PermissionMode,
  })
  .strict()

function toToolInputSchema(schema: z.ZodType) {
  try {
    return z.toJSONSchema(schema)
  } catch {
    return {}
  }
}

function parseModelReference(value: string) {
  const [providerID, ...rest] = value.split("/")
  const modelID = rest.join("/")
  if (!providerID || !modelID) {
    throw new ApiError(400, "INVALID_MODEL_REFERENCE", `Model '${value}' must use the format provider/model`)
  }

  return {
    providerID,
    modelID,
  }
}

async function resolveSelectableModel(value: string) {
  try {
    return await ModelSelection.resolveSelectableModel(value)
  } catch (error) {
    if (ModelRegistry.isModelNotFoundError(error)) {
      throw new ApiError(400, "MODEL_NOT_FOUND", `Model '${value}' is not available`)
    }

    if (error instanceof Error && error.message.includes("must use the format provider/model")) {
      throw new ApiError(400, "INVALID_MODEL_REFERENCE", error.message)
    }

    throw error
  }
}

async function resolveImageSelectableModel(value: string) {
  try {
    return await ModelSelection.resolveImageSelectableModel(value)
  } catch (error) {
    if (ModelRegistry.isModelNotFoundError(error)) {
      throw new ApiError(400, "MODEL_NOT_FOUND", `Model '${value}' is not available`)
    }
    if (error instanceof Error && error.message.includes("must use the format provider/model")) {
      throw new ApiError(400, "INVALID_MODEL_REFERENCE", error.message)
    }
    if (error instanceof Error && error.message.includes("does not support image output")) {
      throw new ApiError(400, "MODEL_NOT_IMAGE_CAPABLE", error.message)
    }
    throw error
  }
}

function toSkillApiError(error: unknown) {
  if (error instanceof SkillManager.SkillManagerError) {
    if (error.code === "SKILL_FILE_NOT_FOUND" || error.code === "SKILL_NOT_FOUND") {
      return new ApiError(404, error.code, error.message)
    }

    if (error.code === "SKILL_ALREADY_EXISTS") {
      return new ApiError(409, error.code, error.message)
    }

    return new ApiError(400, error.code, error.message)
  }

  if (error instanceof SkillGitInstall.SkillGitInstallError) {
    if (error.code === "SKILL_GIT_PREVIEW_NOT_FOUND") {
      return new ApiError(404, error.code, error.message)
    }

    if (error.code === "SKILL_ALREADY_EXISTS" || error.code === "SKILL_GIT_SKILL_UNAVAILABLE") {
      return new ApiError(409, error.code, error.message)
    }

    return new ApiError(400, error.code, error.message)
  }

  return error
}

function toPromptPresetApiError(error: unknown) {
  if (error instanceof ApiError) return error

  if (error instanceof PromptPresets.PromptPresetStoreError) {
    switch (error.code) {
      case "INVALID_PROMPT_FILE":
      case "INVALID_PROMPT_PATH":
      case "DUPLICATE_PROMPT_PRESET":
        return new ApiError(400, error.code, error.message)
      default:
        return error
    }
  }

  if (!(error instanceof Error)) {
    return error
  }

  if (error.message.startsWith("Unknown prompt preset")) {
    return new ApiError(404, "PROMPT_PRESET_NOT_FOUND", error.message)
  }

  if (error.message.includes("cannot be reset") || error.message.includes("cannot be deleted")) {
    return new ApiError(400, "PROMPT_PRESET_ACTION_NOT_ALLOWED", error.message)
  }

  return error
}

function toPromptUrlInstallApiError(error: unknown) {
  if (error instanceof PromptUrlInstall.PromptUrlInstallError) {
    if (error.code === "PROMPT_URL_PREVIEW_NOT_FOUND") {
      return new ApiError(404, error.code, error.message)
    }

    if (error.code === "PROMPT_URL_FETCH_FAILED") {
      return new ApiError(502, error.code, error.message)
    }

    return new ApiError(400, error.code, error.message)
  }

  return error
}

function toPluginApiError(error: unknown) {
  if (error instanceof Plugin.PluginError) {
    switch (error.code) {
      case "PLUGIN_NOT_FOUND":
      case "INSTALLED_PLUGIN_NOT_FOUND":
      case "PLUGIN_CONNECTOR_NOT_FOUND":
        return new ApiError(404, error.code, error.message)
      case "PLUGIN_ALREADY_INSTALLED":
        return new ApiError(409, error.code, error.message)
      case "PLUGIN_PACKAGE_DOWNLOAD_FAILED":
      case "PLUGIN_REGISTRY_UNAVAILABLE":
        return new ApiError(502, error.code, error.message)
      case "PLUGIN_CONFIG_INVALID":
      case "PLUGIN_RISK_NOT_ALLOWED":
      case "PLUGIN_CONNECTOR_NOT_CONNECTED":
      case "PLUGIN_PACKAGE_UNAVAILABLE":
      case "PLUGIN_PACKAGE_INVALID":
        return new ApiError(400, error.code, error.message)
    }
  }

  return error
}

async function readProviderAuthState(providerID: string) {
  const catalog = await Provider.catalog()
  const item = catalog.find((entry) => entry.id === providerID)
  if (item?.authState) return item.authState
  return ProviderAuth.createDisconnectedProviderAuthState(providerID)
}

function assertProviderConfigDoesNotContainSecrets(input: Config.Provider) {
  if (input.options && "apiKey" in input.options) {
    throw new ApiError(
      400,
      "PROVIDER_API_KEY_NOT_ALLOWED",
      "Provider API keys must be saved through the credential store, not provider config.",
    )
  }
}

function isCustomProviderConfig(provider: Config.Provider | undefined) {
  return provider?.options?.customProvider === true
}

function normalizeCustomProviderBaseURL(raw: string) {
  const value = raw.trim()
  let url: URL

  try {
    url = new URL(value)
  } catch {
    throw new ApiError(400, "CUSTOM_PROVIDER_INVALID_BASE_URL", "API Base URL must be a valid URL.")
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ApiError(400, "CUSTOM_PROVIDER_INVALID_BASE_URL", "API Base URL must use http or https.")
  }

  url.hash = ""
  url.search = ""
  return url.toString().replace(/\/+$/, "")
}

function normalizeCustomProviderChatEndpoint(raw: string) {
  const value = raw.trim()
  if (!value.startsWith("/") || value.startsWith("//") || /[\s?#]/.test(value)) {
    throw new ApiError(
      400,
      "CUSTOM_PROVIDER_INVALID_CHAT_ENDPOINT",
      "Chat endpoint must be a path like /chat/completions.",
    )
  }
  return value.replace(/\/+$/, "") || "/"
}

function normalizeCustomProviderModel(raw: string) {
  const value = raw.trim()
  if (!value || /\s/.test(value)) {
    throw new ApiError(400, "CUSTOM_PROVIDER_INVALID_MODEL", "Default model must be a non-empty model ID without spaces.")
  }
  return value
}

function parseCustomProviderAuthHeader(raw: string) {
  const value = raw.trim()
  const separatorIndex = value.indexOf(":")
  if (separatorIndex <= 0) {
    throw new ApiError(
      400,
      "CUSTOM_PROVIDER_INVALID_AUTH_HEADER",
      "Authentication header must look like Authorization: Bearer sk-...",
    )
  }

  const headerName = value.slice(0, separatorIndex).trim()
  const headerValue = value.slice(separatorIndex + 1).trim()

  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(headerName) || !headerValue) {
    throw new ApiError(
      400,
      "CUSTOM_PROVIDER_INVALID_AUTH_HEADER",
      "Authentication header must include a valid header name and value.",
    )
  }

  return { headerName, headerValue }
}

function toCustomProviderBearerHeaderValue(raw: string) {
  const value = raw.trim()
  return value.replace(/^Bearer\s+/i, "Bearer ").startsWith("Bearer ")
    ? value.replace(/^Bearer\s+/i, "Bearer ")
    : `Bearer ${value}`
}

function normalizeCustomProviderAuthorization(input: { apiKey?: string; authHeader?: string }) {
  const rawApiKey = input.apiKey?.trim()
  if (rawApiKey) {
    if (/[\r\n]/.test(rawApiKey)) {
      throw new ApiError(400, "CUSTOM_PROVIDER_INVALID_API_KEY", "API key must be a single line.")
    }

    if (rawApiKey.includes(":")) {
      const parsed = parseCustomProviderAuthHeader(rawApiKey)
      if (parsed.headerName.toLowerCase() !== "authorization") {
        throw new ApiError(
          400,
          "CUSTOM_PROVIDER_INVALID_API_KEY",
          "Custom provider API key uses the fixed Authorization: Bearer format.",
        )
      }
      return {
        headerName: "Authorization",
        headerValue: toCustomProviderBearerHeaderValue(parsed.headerValue),
      }
    }

    return {
      headerName: "Authorization",
      headerValue: toCustomProviderBearerHeaderValue(rawApiKey),
    }
  }

  const legacyAuthHeader = input.authHeader?.trim()
  if (legacyAuthHeader) {
    const parsed = parseCustomProviderAuthHeader(legacyAuthHeader)
    if (parsed.headerName.toLowerCase() !== "authorization") {
      throw new ApiError(
        400,
        "CUSTOM_PROVIDER_INVALID_API_KEY",
        "Custom provider API key uses the fixed Authorization: Bearer format.",
      )
    }
    return {
      headerName: "Authorization",
      headerValue: toCustomProviderBearerHeaderValue(parsed.headerValue),
    }
  }

  return {
    headerName: "Authorization",
    headerValue: undefined,
  }
}

function customProviderIDFor(input: { apiBaseURL: string; defaultModel: string; chatEndpoint: string }) {
  const host = new URL(input.apiBaseURL).host
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "endpoint"
  const hash = createHash("sha256")
    .update(`${input.apiBaseURL}\n${input.defaultModel}\n${input.chatEndpoint}`)
    .digest("hex")
    .slice(0, 8)
  return `${CUSTOM_PROVIDER_PREFIX}${host}-${hash}`
}

function normalizeCustomProviderInput(input: z.infer<typeof UpsertCustomProviderBody>) {
  const apiBaseURL = normalizeCustomProviderBaseURL(input.apiBaseURL)
  const chatEndpoint = normalizeCustomProviderChatEndpoint(input.chatEndpoint)
  const defaultModel = normalizeCustomProviderModel(input.defaultModel)
  const authHeader = normalizeCustomProviderAuthorization(input)
  const providerID = input.providerID?.trim() || customProviderIDFor({ apiBaseURL, defaultModel, chatEndpoint })

  if (!providerID.startsWith(CUSTOM_PROVIDER_PREFIX)) {
    throw new ApiError(400, "CUSTOM_PROVIDER_INVALID_ID", `Custom provider IDs must start with '${CUSTOM_PROVIDER_PREFIX}'.`)
  }

  return {
    providerID,
    apiBaseURL,
    chatEndpoint,
    defaultModel,
    ...authHeader,
  }
}

function buildCustomProviderChatURL(apiBaseURL: string, chatEndpoint: string) {
  const url = new URL(apiBaseURL)
  const basePath = url.pathname.replace(/\/+$/, "")
  url.pathname = `${basePath}${chatEndpoint}`.replace(/\/{2,}/g, "/")
  return url.toString()
}

type NormalizedCustomProviderInput = ReturnType<typeof normalizeCustomProviderInput>

function buildCustomProviderConfig(input: NormalizedCustomProviderInput): Config.Provider {
  const host = new URL(input.apiBaseURL).host
  return {
    id: input.providerID,
    name: `Custom · ${host}`,
    env: [],
    api: input.apiBaseURL,
    npm: CUSTOM_PROVIDER_SDK_PACKAGE,
    options: {
      baseURL: input.apiBaseURL,
      customProvider: true,
      customAuthHeaderName: input.headerName,
      customChatEndpoint: input.chatEndpoint,
      customDefaultModel: input.defaultModel,
    },
    models: {
      [input.defaultModel]: {
        id: input.defaultModel,
        name: input.defaultModel,
        provider: {
          api: input.apiBaseURL,
          npm: CUSTOM_PROVIDER_SDK_PACKAGE,
        },
        reasoning: false,
        temperature: true,
        tool_call: true,
        attachment: false,
        modalities: {
          input: ["text"],
          output: ["text"],
        },
        options: {},
      },
    },
  }
}

async function resolveCustomProviderHeaderValue(input: NormalizedCustomProviderInput) {
  if (input.headerValue) return input.headerValue

  const existingConfig = await Config.get(Config.GLOBAL_CONFIG_ID)
  if (!isCustomProviderConfig(existingConfig.provider?.[input.providerID])) {
    throw new ApiError(400, "CUSTOM_PROVIDER_INVALID_API_KEY", "API key is required for new custom providers.")
  }

  const runtimeAuth = await ProviderAuth.resolveProviderRuntimeAuth(input.providerID, {}, {
    method: "api-key",
    credentialMode: "active",
  })
  if (runtimeAuth.apiKey) return runtimeAuth.apiKey

  throw new ApiError(
    400,
    "CUSTOM_PROVIDER_INVALID_API_KEY",
    "API key is required because this custom provider has no saved key.",
  )
}

function extractCustomProviderTestFailure(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return typeof payload === "string" ? payload : undefined
  }

  const record = payload as Record<string, unknown>
  const error = record.error
  if (typeof error === "string") return error
  if (error && typeof error === "object") {
    const errorRecord = error as Record<string, unknown>
    for (const key of ["message", "detail", "error"]) {
      const value = errorRecord[key]
      if (typeof value === "string" && value.trim()) return value.trim()
    }
  }

  for (const key of ["message", "detail", "error"]) {
    const value = record[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }

  return undefined
}

async function runCustomProviderConnectionTest(input: NormalizedCustomProviderInput) {
  const url = buildCustomProviderChatURL(input.apiBaseURL, input.chatEndpoint)
  const headers = new Headers({
    "content-type": "application/json",
    accept: "application/json",
  })
  headers.set(input.headerName, await resolveCustomProviderHeaderValue(input))

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: input.defaultModel,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1,
      stream: false,
    }),
    signal: AbortSignal.timeout(CUSTOM_PROVIDER_TEST_TIMEOUT_MS),
  })

  if (response.ok) return

  const contentType = response.headers.get("content-type") ?? ""
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => undefined)
    : await response.text().catch(() => undefined)
  const detail = extractCustomProviderTestFailure(payload)
  const message = detail
    ? `Custom provider chat test failed (${response.status}): ${detail}`
    : `Custom provider chat test failed (${response.status}).`

  throw new ApiError(
    response.status === 401 || response.status === 403 ? 401 : 400,
    response.status === 401 || response.status === 403 ? "CUSTOM_PROVIDER_AUTH_FAILED" : "CUSTOM_PROVIDER_TEST_FAILED",
    message,
  )
}

export async function listProviderCatalog() {
  return Provider.catalog()
}

export async function refreshProviderCatalog() {
  try {
    await ModelsDev.refresh()
  } catch (error) {
    throw new ApiError(
      502,
      "PROVIDER_CATALOG_REFRESH_FAILED",
      error instanceof Error ? error.message : String(error),
    )
  }

  clearProjectModelListCache()
  return Provider.catalog()
}

export async function listProviders() {
  return {
    items: await Provider.listPublicProviders(),
    selection: await Provider.getSelection(),
  }
}

export async function listModels() {
  return {
    items: await ModelRegistry.listAISDKModels(),
    selection: await Provider.getSelection(),
  }
}

export async function listModelCatalog() {
  return {
    items: await ModelRegistry.listModelCatalog(Config.GLOBAL_CONFIG_ID),
  }
}

export async function updateProvider(
  providerID: string,
  input: z.infer<typeof UpdateGlobalProviderBody>,
) {
  assertProviderConfigDoesNotContainSecrets(input)

  try {
    await Provider.validateProviderConfig(providerID, input, Config.GLOBAL_CONFIG_ID)
  } catch (error) {
    throw new ApiError(
      400,
      "PROVIDER_VALIDATION_FAILED",
      error instanceof Error ? error.message : String(error),
    )
  }

  const providerConfig = await Config.setProvider(Config.GLOBAL_CONFIG_ID, providerID, input)
  clearProjectModelListCache()
  const provider = await Provider.getPublicProvider(providerID)
  if (!provider) {
    throw new ApiError(404, "PROVIDER_NOT_FOUND", `Provider '${providerID}' not found in the catalog`)
  }

  return {
    provider,
    selection: {
      model: providerConfig.model,
      small_model: providerConfig.small_model,
      image_model: providerConfig.image_model,
      image_generation: providerConfig.image_generation,
      reasoning_effort: providerConfig.reasoning_effort,
    },
  }
}

export async function upsertCustomProvider(input: z.infer<typeof UpsertCustomProviderBody>) {
  const normalized = normalizeCustomProviderInput(input)
  const providerConfig = buildCustomProviderConfig(normalized)
  const modelReference = `${normalized.providerID}/${normalized.defaultModel}`

  if (normalized.headerValue) {
    await ProviderAuth.saveProviderApiKey(normalized.providerID, normalized.headerValue)
  } else {
    await resolveCustomProviderHeaderValue(normalized)
  }
  const existingConfig = await Config.get(Config.GLOBAL_CONFIG_ID)
  if (isCustomProviderConfig(existingConfig.provider?.[normalized.providerID])) {
    await Config.removeProvider(Config.GLOBAL_CONFIG_ID, normalized.providerID)
  }
  await Config.setProvider(Config.GLOBAL_CONFIG_ID, normalized.providerID, providerConfig)
  const selection = await Config.setModelSelection(Config.GLOBAL_CONFIG_ID, {
    model: modelReference,
    small_model: modelReference,
    reasoning_effort: null,
  })
  clearProjectModelListCache()
  const provider = await Provider.getPublicProvider(normalized.providerID)
  if (!provider) {
    throw new ApiError(404, "PROVIDER_NOT_FOUND", `Provider '${normalized.providerID}' not found after saving`)
  }

  return {
    provider,
    selection: {
      model: selection.model,
      small_model: selection.small_model,
      image_model: selection.image_model,
      image_generation: selection.image_generation,
      reasoning_effort: selection.reasoning_effort,
    },
  }
}

export async function testCustomProviderConnection(input: z.infer<typeof TestCustomProviderConnectionBody>) {
  const normalized = normalizeCustomProviderInput(input)

  try {
    await runCustomProviderConnectionTest(normalized)
    return {
      providerID: normalized.providerID,
      ok: true,
      status: "working" as const,
      checkedAt: Date.now(),
      message: "自定义 Provider 聊天接口测试成功。",
    }
  } catch (error) {
    const classified = classifyProviderConnectionError(error)
    return {
      providerID: normalized.providerID,
      ok: false,
      status: classified.status,
      checkedAt: Date.now(),
      message: classified.message,
      errorCode: classified.errorCode,
      diagnostics: classified.diagnostics,
    }
  }
}

export async function removeProvider(providerID: string) {
  const existingConfig = await Config.get(Config.GLOBAL_CONFIG_ID)
  const shouldRemoveCredential = isCustomProviderConfig(existingConfig.provider?.[providerID])
  const providerConfig = await Config.removeProvider(Config.GLOBAL_CONFIG_ID, providerID)
  if (shouldRemoveCredential) {
    await ProviderAuth.saveProviderApiKey(providerID, null)
  }
  clearProjectModelListCache()

  return {
    providerID,
    selection: {
      model: providerConfig.model,
      small_model: providerConfig.small_model,
      image_model: providerConfig.image_model,
      image_generation: providerConfig.image_generation,
      reasoning_effort: providerConfig.reasoning_effort,
    },
  }
}

export async function updateModelSelection(input: z.infer<typeof UpdateGlobalModelSelectionBody>) {
  if (input.model) {
    await resolveSelectableModel(input.model)
  }

  if (input.small_model) {
    await resolveSelectableModel(input.small_model)
  }

  if (input.image_model) {
    await resolveImageSelectableModel(input.image_model)
  }

  const selection = await Config.setModelSelection(Config.GLOBAL_CONFIG_ID, input)

  return {
    model: selection.model,
    small_model: selection.small_model,
    image_model: selection.image_model,
    image_generation: selection.image_generation,
    reasoning_effort: selection.reasoning_effort,
  }
}

export async function getProviderAuth(providerID: string) {
  return readProviderAuthState(providerID)
}

export async function getAnyboxProviderRelaySession() {
  const runtimeAuth = await ProviderAuth.resolveProviderRuntimeAuth("anybox", {}, {})
  const baseURL = runtimeAuth.runtimeBaseURL
  const account = runtimeAuth.authState.account

  if (!runtimeAuth.apiKey || runtimeAuth.authState.status !== "connected") {
    return {
      connected: false,
      status: runtimeAuth.authState.status,
      ...(baseURL ? { baseURL } : {}),
      ...(account ? { account } : {}),
      ...(runtimeAuth.authState.lastError ? { error: runtimeAuth.authState.lastError } : {}),
    }
  }

  return {
    connected: true,
    status: runtimeAuth.authState.status,
    accessToken: runtimeAuth.apiKey,
    ...(baseURL ? { baseURL } : {}),
    ...(account ? { account } : {}),
    ...(runtimeAuth.authState.expiresAt ? { expiresAt: runtimeAuth.authState.expiresAt } : {}),
  }
}

function classifyProviderConnectionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (error instanceof AnyboxHTTP.AnyboxHTTPError) {
    const status = error.code === "http_error" ? "auth_error" : "network_error"
    return {
      status: status as "auth_error" | "network_error" | "config_error",
      message,
      errorCode: error.code,
      diagnostics: error.diagnostics,
    }
  }

  const normalized = message.toLowerCase()

  if (
    normalized.includes("rejected the api key") ||
    normalized.includes("401") ||
    normalized.includes("403") ||
    normalized.includes("unauthorized") ||
    normalized.includes("forbidden")
  ) {
    return {
      status: "auth_error" as const,
      message,
      errorCode: undefined,
      diagnostics: undefined,
    }
  }

  if (
    normalized.includes("could not reach") ||
    normalized.includes("network") ||
    normalized.includes("timeout") ||
    normalized.includes("fetch") ||
    normalized.includes("enotfound") ||
    normalized.includes("econnrefused")
  ) {
    return {
      status: "network_error" as const,
      message,
      errorCode: undefined,
      diagnostics: undefined,
    }
  }

  return {
    status: "config_error" as const,
    message,
    errorCode: undefined,
    diagnostics: undefined,
  }
}

function toConnectorApiError(error: unknown) {
  if (error instanceof Connector.ConnectorError) {
    switch (error.code) {
      case "CONNECTOR_NOT_FOUND":
        return new ApiError(404, error.code, error.message)
      case "CONNECTOR_RUNTIME_MISSING":
      case "CONNECTOR_UNAVAILABLE":
      case "CONNECTOR_CREDENTIAL_UNSUPPORTED":
      case "CONNECTOR_NOT_CONNECTED":
      case "CONNECTOR_CONFIG_REQUIRED":
      case "CONNECTOR_CONFIG_UNSUPPORTED":
      case "CONNECTOR_REGISTRY_INVALID":
        return new ApiError(400, error.code, error.message)
    }
  }

  return error
}

function getProviderConnectionCapability(
  provider: Provider.ProviderCatalogItem,
  method: string | undefined,
) {
  if (!method) return undefined
  return provider.authCapabilities.find((capability) => capability.method === method)
}

function hasProviderConnectionCandidate(
  provider: Provider.ProviderCatalogItem,
  input: {
    method?: string
    credentialMode?: "active" | "manual" | "environment"
    apiKey?: string
  },
) {
  const capability = getProviderConnectionCapability(provider, input.method)
  const credentials = provider.authState.credentials

  if (input.method && !capability) return false

  if (capability?.kind === "api_key") {
    if (input.apiKey) return true

    if (input.credentialMode === "environment") {
      return credentials.some(
        (credential) =>
          credential.method === capability.method &&
          credential.kind === "api_key" &&
          credential.source === "environment" &&
          credential.configured,
      )
    }

    if (input.credentialMode === "manual") {
      return credentials.some(
        (credential) =>
          credential.method === capability.method &&
          credential.kind === "api_key" &&
          credential.source === "credential_store" &&
          credential.configured,
      )
    }

    return credentials.some(
      (credential) =>
        credential.method === capability.method &&
        credential.kind === "api_key" &&
        credential.configured,
    )
  }

  if (capability) {
    return credentials.some(
      (credential) =>
        credential.method === capability.method &&
        credential.configured,
    )
  }

  return provider.authState.status === "connected" || provider.apiKeyConfigured
}

export async function testProviderConnection(
  providerID: string,
  input: z.infer<typeof ProviderConnectionTestBody>,
) {
  const catalog = await Provider.catalog()
  const provider = catalog.find((entry) => entry.id === providerID)

  if (!provider) {
    throw new ApiError(404, "PROVIDER_NOT_FOUND", `Provider '${providerID}' not found in the catalog`)
  }

  const method = input.method?.trim() || provider.authState.activeMethod
  const credentialMode = input.credentialMode ?? "active"
  const apiKey = input.apiKey?.trim()
  const baseURL = input.baseURL?.trim()
  const capability = getProviderConnectionCapability(provider, method)

  if (method && !capability) {
    return {
      providerID,
      ok: false,
      status: "unsupported" as const,
      checkedAt: Date.now(),
      message: `Provider '${provider.name}' does not support connection method '${method}'.`,
    }
  }

  if (!hasProviderConnectionCandidate(provider, { method, credentialMode, apiKey })) {
    return {
      providerID,
      ok: false,
      status: "not_connected" as const,
      checkedAt: Date.now(),
      message: "未找到可用连接。请先配置环境变量、登录账号或保存 API key。",
    }
  }

  try {
    const optionsPayload: {
      apiKey?: string
      baseURL?: string
    } = {}

    if (apiKey) optionsPayload.apiKey = apiKey
    if (baseURL) optionsPayload.baseURL = baseURL

    await Provider.validateProviderConfig(
      providerID,
      {
        name: provider.name,
        env: provider.env,
        options: Object.keys(optionsPayload).length > 0 ? optionsPayload : undefined,
      },
      Config.GLOBAL_CONFIG_ID,
      {
        auth: {
          method,
          credentialMode,
          transientApiKey: apiKey,
        },
        requireCredential: true,
      },
    )

    return {
      providerID,
      ok: true,
      status: "working" as const,
      checkedAt: Date.now(),
      message: "连接测试成功。",
    }
  } catch (error) {
    const classified = classifyProviderConnectionError(error)
    return {
      providerID,
      ok: false,
      status: classified.status,
      checkedAt: Date.now(),
      message: classified.message,
      errorCode: classified.errorCode,
      diagnostics: classified.diagnostics,
    }
  }
}

export async function startProviderAuthFlow(input: {
  providerID: string
  method: string
  serverBaseURL: string
  baseURL?: string | null
  prompt?: "login" | "select_account"
}) {
  try {
    const catalog = await Provider.catalog()
    const provider = catalog.find((entry) => entry.id === input.providerID)
    return await ProviderAuth.startProviderAuthFlow({
      ...input,
      providerBaseURL: input.baseURL?.trim() || provider?.baseURL,
    })
  } catch (error) {
    if (error instanceof AnyboxHTTP.AnyboxHTTPError) {
      log.warn("provider-auth-flow-network-failed", {
        providerID: input.providerID,
        method: input.method,
        errorCode: error.code,
        diagnostics: error.diagnostics,
        message: error.message,
      })
    }
    throw new ApiError(400, "PROVIDER_AUTH_FLOW_FAILED", error instanceof Error ? error.message : String(error))
  }
}

export async function getProviderAuthFlow(providerID: string, flowID: string) {
  const flow = await ProviderAuth.getProviderFlow(providerID, flowID)
  if (!flow) {
    throw new ApiError(404, "PROVIDER_AUTH_FLOW_NOT_FOUND", `Auth flow '${flowID}' was not found`)
  }

  if (flow.status === "connected") {
    clearProjectModelListCache()
  }

  return flow
}

export async function cancelProviderAuthFlow(providerID: string, flowID: string) {
  const flow = await ProviderAuth.cancelProviderAuthFlow(providerID, flowID)
  if (!flow) {
    throw new ApiError(404, "PROVIDER_AUTH_FLOW_NOT_FOUND", `Auth flow '${flowID}' was not found`)
  }

  return flow
}

export async function completeProviderAuthCallback(providerID: string, url: URL) {
  const result = await ProviderAuth.completeProviderBrowserCallback({
    providerID,
    url,
  })
  if (result.ok) {
    clearProjectModelListCache()
  }

  return {
    html: ProviderAuth.renderProviderAuthCallbackPage({
      ok: result.ok,
      title: result.title,
      message: result.message,
    }),
    status: result.status,
  }
}

export async function saveProviderApiKey(
  providerID: string,
  input: z.infer<typeof ProviderAuthApiKeyBody>,
) {
  await ProviderAuth.saveProviderApiKey(providerID, input.apiKey)
  clearProjectModelListCache()
  return readProviderAuthState(providerID)
}

export async function deleteProviderSession(providerID: string) {
  await ProviderAuth.deleteProviderSession(providerID)
  clearProjectModelListCache()
  return readProviderAuthState(providerID)
}

export async function listMcpServers() {
  return Config.listMcpServers(Config.GLOBAL_CONFIG_ID)
}

export async function updateMcpServer(serverID: string, input: z.infer<typeof UpdateMcpServerBody>) {
  return Config.setMcpServer(Config.GLOBAL_CONFIG_ID, serverID, input)
}

export async function getMcpServerDiagnostic(serverID: string) {
  const server = await Config.getMcpServer(Config.GLOBAL_CONFIG_ID, serverID)
  if (!server) {
    throw new ApiError(404, "MCP_SERVER_NOT_FOUND", `MCP server '${serverID}' is not configured globally`)
  }

  return Mcp.diagnoseServer(server)
}

export async function removeMcpServer(serverID: string) {
  return {
    serverID,
    removed: Boolean(await Config.removeMcpServer(Config.GLOBAL_CONFIG_ID, serverID)),
  }
}

export async function listPluginCatalog(input: z.infer<typeof PluginCatalogQuery> = {}) {
  return input.freshness === "cached" ? Plugin.listCachedCatalog() : await Plugin.listCatalog()
}

export function listInstalledPlugins() {
  return Plugin.listInstalled()
}

export async function importPluginFromURL(input: z.infer<typeof ImportPluginURLBody>) {
  try {
    return await Plugin.importFromURL(input)
  } catch (error) {
    throw toPluginApiError(error)
  }
}

export async function installPlugin(pluginID: string, input: z.infer<typeof InstallPluginBody>) {
  try {
    return await Plugin.install(pluginID, input)
  } catch (error) {
    throw toPluginApiError(error)
  }
}

export async function updateInstalledPlugin(pluginID: string, input: z.infer<typeof UpdateInstalledPluginBody>) {
  try {
    return await Plugin.update(pluginID, input)
  } catch (error) {
    throw toPluginApiError(error)
  }
}

export async function removeInstalledPlugin(pluginID: string) {
  try {
    return await Plugin.remove(pluginID)
  } catch (error) {
    throw toPluginApiError(error)
  }
}

export async function getInstalledPluginDiagnostic(pluginID: string) {
  try {
    return await Plugin.diagnose(pluginID)
  } catch (error) {
    throw toPluginApiError(error)
  }
}

export function listConnectorCatalog() {
  try {
    return Connector.listDefinitions()
  } catch (error) {
    throw toConnectorApiError(error)
  }
}

export async function listConnectors() {
  try {
    return await Connector.listStatuses()
  } catch (error) {
    throw toConnectorApiError(error)
  }
}

export async function getConnector(connectorID: string) {
  try {
    return await Connector.getStatus(connectorID)
  } catch (error) {
    throw toConnectorApiError(error)
  }
}

export async function saveConnectorApiKey(
  connectorID: string,
  input: z.infer<typeof SaveConnectorApiKeyBody>,
) {
  try {
    return await Connector.saveConnectorApiKey(connectorID, input)
  } catch (error) {
    throw toConnectorApiError(error)
  }
}

export async function deleteConnectorApiKey(connectorID: string) {
  try {
    return await Connector.removeConnectorApiKey(connectorID)
  } catch (error) {
    throw toConnectorApiError(error)
  }
}

export async function saveConnectorConfig(
  connectorID: string,
  input: z.infer<typeof SaveConnectorConfigBody>,
) {
  try {
    return await Connector.saveConnectorConfig(connectorID, input)
  } catch (error) {
    throw toConnectorApiError(error)
  }
}

export async function deleteConnectorConfig(connectorID: string) {
  try {
    return await Connector.removeConnectorConfig(connectorID)
  } catch (error) {
    throw toConnectorApiError(error)
  }
}

export async function startConnectorAuthFlow(connectorID: string, input: { serverBaseURL: string }) {
  try {
    return await Connector.startConnectorOAuthFlow(connectorID, input)
  } catch (error) {
    throw toConnectorApiError(error)
  }
}

export async function getConnectorAuthFlow(connectorID: string, flowID: string) {
  try {
    return await Connector.getConnectorOAuthFlow(connectorID, flowID)
  } catch (error) {
    throw toConnectorApiError(error)
  }
}

export async function cancelConnectorAuthFlow(connectorID: string, flowID: string) {
  try {
    return await Connector.cancelConnectorOAuthFlow(connectorID, flowID)
  } catch (error) {
    throw toConnectorApiError(error)
  }
}

export async function deleteConnectorAuthSession(connectorID: string) {
  try {
    return await Connector.deleteConnectorOAuthSession(connectorID)
  } catch (error) {
    throw toConnectorApiError(error)
  }
}

export async function getConnectorDiagnostic(connectorID: string) {
  try {
    return await Connector.diagnoseConnector(connectorID)
  } catch (error) {
    throw toConnectorApiError(error)
  }
}

export async function listInstalledPluginConnectors(pluginID: string) {
  try {
    return await Plugin.listConnectorStatuses(pluginID)
  } catch (error) {
    throw toPluginApiError(error)
  }
}

export async function saveInstalledPluginConnectorApiKey(
  pluginID: string,
  appID: string,
  input: z.infer<typeof SavePluginConnectorApiKeyBody>,
) {
  try {
    return await Plugin.saveConnectorApiKey(pluginID, appID, input)
  } catch (error) {
    throw toPluginApiError(error)
  }
}

export async function deleteInstalledPluginConnectorApiKey(pluginID: string, appID: string) {
  try {
    return await Plugin.removeConnectorApiKey(pluginID, appID)
  } catch (error) {
    throw toPluginApiError(error)
  }
}

export async function startInstalledPluginConnectorAuthFlow(
  pluginID: string,
  appID: string,
  input: { serverBaseURL: string },
) {
  try {
    return await Plugin.startConnectorOAuthFlow(pluginID, appID, input)
  } catch (error) {
    throw toPluginApiError(error)
  }
}

export async function getInstalledPluginConnectorAuthFlow(pluginID: string, appID: string, flowID: string) {
  try {
    return await Plugin.getConnectorOAuthFlow(pluginID, appID, flowID)
  } catch (error) {
    throw toPluginApiError(error)
  }
}

export async function cancelInstalledPluginConnectorAuthFlow(pluginID: string, appID: string, flowID: string) {
  try {
    return await Plugin.cancelConnectorOAuthFlow(pluginID, appID, flowID)
  } catch (error) {
    throw toPluginApiError(error)
  }
}

export async function deleteInstalledPluginConnectorAuthSession(pluginID: string, appID: string) {
  try {
    return await Plugin.deleteConnectorOAuthSession(pluginID, appID)
  } catch (error) {
    throw toPluginApiError(error)
  }
}

export async function getInstalledPluginConnectorDiagnostic(pluginID: string, appID: string) {
  try {
    return await Plugin.diagnoseConnector(pluginID, appID)
  } catch (error) {
    throw toPluginApiError(error)
  }
}

export async function listBuiltinTools() {
  const [items, selection] = await Promise.all([
    ToolRegistry.builtinTools(),
    Config.getToolSelection(Config.GLOBAL_CONFIG_ID),
  ])

  return {
    items: await Promise.all(
      items.map(async (item) => {
        const runtime = await item.init()
        const explicitStates = [item.id, ...(item.aliases ?? [])]
          .map((name) => selection.tools[name])
          .filter((value): value is boolean => typeof value === "boolean")

        return {
          id: item.id,
          title: runtime.title ?? item.title ?? item.id,
          description: runtime.description,
          inputSchema: toToolInputSchema(runtime.parameters),
          aliases: item.aliases ?? [],
          capabilities: item.capabilities ?? {},
          enabled: !explicitStates.includes(false),
        }
      }),
    ),
    selection,
  }
}

export async function updateBuiltinToolSelection(input: z.infer<typeof UpdateBuiltinToolSelectionBody>) {
  const items = await ToolRegistry.builtinTools()
  const knownToolIDs = new Map<string, string>()
  for (const item of items) {
    knownToolIDs.set(item.id, item.id)
    for (const alias of item.aliases ?? []) {
      knownToolIDs.set(alias, item.id)
    }
  }

  const tools: Record<string, boolean> = {}

  for (const [toolID, enabled] of Object.entries(input.tools)) {
    const normalizedToolID = toolID.trim()
    if (!normalizedToolID) continue
    const canonicalToolID = knownToolIDs.get(normalizedToolID)
    if (!canonicalToolID) {
      throw new ApiError(400, "UNKNOWN_BUILTIN_TOOL", `Unknown built-in tool id '${normalizedToolID}'.`)
    }
    tools[canonicalToolID] = enabled
  }

  return Config.setToolSelection(Config.GLOBAL_CONFIG_ID, tools)
}

export async function getToolPermissionMode() {
  return Config.getPermissionMode(Config.GLOBAL_CONFIG_ID)
}

export async function updateToolPermissionMode(input: z.infer<typeof UpdateToolPermissionModeBody>) {
  return Config.setPermissionMode(Config.GLOBAL_CONFIG_ID, input.mode)
}

export async function listPromptPresets() {
  return PromptPresets.listPromptPresetSummaries(Config.GLOBAL_CONFIG_ID)
}

export async function getPromptPresetSelection() {
  return PromptPresets.getPromptPresetSelection(Config.GLOBAL_CONFIG_ID)
}

export async function updatePromptPresetSelection(input: z.infer<typeof PromptPresetSelectionBody>) {
  try {
    return await PromptPresets.updatePromptPresetSelection(input, Config.GLOBAL_CONFIG_ID)
  } catch (error) {
    throw toPromptPresetApiError(error)
  }
}

export async function createPromptPreset(input: z.infer<typeof PromptPresetCreateBody>) {
  try {
    return await PromptPresets.createPromptPreset(input, Config.GLOBAL_CONFIG_ID)
  } catch (error) {
    throw toPromptPresetApiError(error)
  }
}

export async function translatePromptPreset(input: z.infer<typeof PromptPresetTranslationBody>) {
  try {
    const targetLanguage = PROMPT_TRANSLATION_LANGUAGES[input.languageID]
    const model = await resolvePromptTranslationModel(input.model)
    const languageModel = await ModelRuntime.getLanguage(model, Config.GLOBAL_CONFIG_ID)
    const generateText = await runtimeDependencies.getGenerateText()
    const result = await runPromptTranslationGeneration({
      content: input.content,
      generateText,
      languageInstruction: targetLanguage.instruction,
      languageModel,
      model,
    })
    const translatedContent = result.text.trim()
    if (!translatedContent) {
      throw new ApiError(502, "PROMPT_TRANSLATION_EMPTY", "Model returned an empty prompt translation.")
    }

    const existingPromptPresets = await PromptPresets.listPromptPresetSummaries(Config.GLOBAL_CONFIG_ID)
    const label = buildUniquePromptTranslationLabel({
      sourceLabel: input.sourceLabel,
      languageLabel: targetLanguage.label,
      existingLabels: existingPromptPresets.map((preset) => preset.label),
    })

    return await PromptPresets.createPromptPreset({
      label,
      content: translatedContent,
      description: `Translated from ${input.sourceLabel.trim() || "prompt"} to ${targetLanguage.label}.`,
    }, Config.GLOBAL_CONFIG_ID)
  } catch (error) {
    throw toPromptPresetApiError(error)
  }
}

export async function readPromptPreset(presetID: string) {
  try {
    return await PromptPresets.readPromptPresetDocument(presetID, Config.GLOBAL_CONFIG_ID)
  } catch (error) {
    throw toPromptPresetApiError(error)
  }
}

export async function updatePromptPreset(presetID: string, input: z.infer<typeof PromptPresetBody>) {
  try {
    return await PromptPresets.updatePromptPreset(presetID, input, Config.GLOBAL_CONFIG_ID)
  } catch (error) {
    throw toPromptPresetApiError(error)
  }
}

export async function resetPromptPreset(presetID: string) {
  try {
    return await PromptPresets.resetPromptPreset(presetID, Config.GLOBAL_CONFIG_ID)
  } catch (error) {
    throw toPromptPresetApiError(error)
  }
}

export async function deletePromptPreset(presetID: string) {
  try {
    return await PromptPresets.deletePromptPreset(presetID, Config.GLOBAL_CONFIG_ID)
  } catch (error) {
    throw toPromptPresetApiError(error)
  }
}

export async function previewPromptUrlInstall(input: z.infer<typeof PreviewPromptUrlInstallBody>) {
  try {
    return await PromptUrlInstall.previewPromptUrlInstall(input.source)
  } catch (error) {
    throw toPromptUrlInstallApiError(error)
  }
}

export async function installPromptUrlPreview(input: z.infer<typeof InstallPromptUrlPreviewBody>) {
  try {
    return await PromptUrlInstall.installPromptsFromUrlPreview(input, Config.GLOBAL_CONFIG_ID)
  } catch (error) {
    throw toPromptUrlInstallApiError(toPromptPresetApiError(error))
  }
}

type PromptTranslationLanguageID = z.infer<typeof PromptTranslationLanguageID>

const PROMPT_TRANSLATION_LANGUAGES: Record<PromptTranslationLanguageID, {
  label: string
  instruction: string
}> = {
  en: { label: "English", instruction: "English" },
  "zh-Hans": { label: "简体中文", instruction: "Simplified Chinese" },
  "zh-Hant": { label: "繁體中文", instruction: "Traditional Chinese" },
  es: { label: "Spanish", instruction: "Spanish" },
  fr: { label: "French", instruction: "French" },
  de: { label: "German", instruction: "German" },
  pt: { label: "Portuguese", instruction: "Portuguese" },
  it: { label: "Italian", instruction: "Italian" },
  ja: { label: "Japanese", instruction: "Japanese" },
  ko: { label: "Korean", instruction: "Korean" },
  nl: { label: "Dutch", instruction: "Dutch" },
  ru: { label: "Russian", instruction: "Russian" },
}

const PROMPT_TRANSLATION_SYSTEM_PROMPT = [
  "You are translating an AI system prompt.",
  "Translate the prompt into the target language.",
  "Preserve Markdown structure, headings, lists, code fences, XML/HTML tags, variables, placeholders, commands, file paths, API names, model names, product names, and policy keywords.",
  "Do not summarize, omit, add commentary, or explain.",
  "Return only the translated prompt.",
].join("\n")

async function runPromptTranslationGeneration(input: {
  content: string
  generateText: GenerateTextFunction
  languageInstruction: string
  languageModel: Awaited<ReturnType<typeof ModelRuntime.getLanguage>>
  model: Model
}) {
  try {
    const temperature = getPromptTranslationTemperature(input.model)
    return await input.generateText({
      model: input.languageModel,
      ...(temperature === undefined ? {} : { temperature }),
      system: PROMPT_TRANSLATION_SYSTEM_PROMPT,
      prompt: buildPromptTranslationPrompt({
        content: input.content,
        languageInstruction: input.languageInstruction,
      }),
    })
  } catch (error) {
    throw new ApiError(
      502,
      "PROMPT_TRANSLATION_FAILED",
      `Prompt translation failed: ${getPromptTranslationErrorMessage(error)}`,
    )
  }
}

function getPromptTranslationTemperature(model: Model) {
  if (!model.capabilities.temperature) return undefined
  if (ProviderTransform.isProviderReasoningModel(model)) return undefined
  return 0
}

function getPromptTranslationErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message
  return String(error)
}

function buildPromptTranslationPrompt(input: {
  content: string
  languageInstruction: string
}) {
  return [
    `Target language: ${input.languageInstruction}`,
    "",
    "Source prompt:",
    "<prompt>",
    input.content,
    "</prompt>",
  ].join("\n")
}

function buildUniquePromptTranslationLabel(input: {
  sourceLabel: string
  languageLabel: string
  existingLabels: string[]
}) {
  const sourceLabel = input.sourceLabel.trim() || "Prompt"
  const baseLabel = `${sourceLabel} - ${input.languageLabel}`
  const existingLabels = new Set(input.existingLabels.map((label) => label.trim().toLowerCase()))
  if (!existingLabels.has(baseLabel.toLowerCase())) return baseLabel

  let suffix = 2
  while (existingLabels.has(`${baseLabel} ${suffix}`.toLowerCase())) {
    suffix += 1
  }

  return `${baseLabel} ${suffix}`
}

async function resolvePromptTranslationModel(value: string) {
  const ref = parseModelReference(value)
  const publicModel = (await ModelRegistry.listAISDKModels(Config.GLOBAL_CONFIG_ID)).find(
    (model) => model.providerID === ref.providerID && model.id === ref.modelID,
  )

  if (!publicModel || !publicModel.available) {
    throw new ApiError(400, "MODEL_NOT_AVAILABLE", `Model '${value}' is not available`)
  }

  if (!publicModel.capabilities.input.text || !publicModel.capabilities.output.text) {
    throw new ApiError(400, "MODEL_NOT_TEXT_CAPABLE", `Model '${value}' does not support text input and output`)
  }

  try {
    const model = await ModelRegistry.getAISDKModel(ref.providerID, ref.modelID, Config.GLOBAL_CONFIG_ID)
    if (!model.capabilities.input.text || !model.capabilities.output.text) {
      throw new ApiError(400, "MODEL_NOT_TEXT_CAPABLE", `Model '${value}' does not support text input and output`)
    }
    return model
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (ModelRegistry.isModelNotFoundError(error)) {
      throw new ApiError(400, "MODEL_NOT_FOUND", `Model '${value}' is not available`)
    }

    throw error
  }
}

function getPluginTreeEntrySortRank(node: SkillManager.GlobalSkillTreeNode) {
  if (node.kind === "file") return node.name === SKILL_FILENAME ? 3 : 4
  if (node.role === "folder") return 0
  if (node.role === "skill") return 1
  return 2
}

function sortPluginTreeEntries(left: SkillManager.GlobalSkillTreeNode, right: SkillManager.GlobalSkillTreeNode) {
  const leftRank = getPluginTreeEntrySortRank(left)
  const rightRank = getPluginTreeEntrySortRank(right)
  if (leftRank !== rightRank) return leftRank - rightRank

  if (left.name === SKILL_FILENAME && right.name !== SKILL_FILENAME) return -1
  if (right.name === SKILL_FILENAME && left.name !== SKILL_FILENAME) return 1

  return left.name.localeCompare(right.name)
}

function isResolvedPathInsideRoot(root: string, path: string) {
  const resolvedRoot = resolve(root)
  const resolvedPath = resolve(path)
  const relativePath = relative(resolvedRoot, resolvedPath)
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))
}

function pluginSkillRootTreePath(root: Plugin.InstalledPluginSkillRoot, rootIndex: number) {
  return `${PLUGIN_SKILLS_TREE_ROOT_PATH}/${encodeURIComponent(root.pluginID)}/${rootIndex}`
}

function pluginSkillTreePath(root: Plugin.InstalledPluginSkillRoot, rootIndex: number, path: string) {
  const resolvedRoot = resolve(root.root)
  const resolvedPath = resolve(path)
  const relativePath = relative(resolvedRoot, resolvedPath)
  const rootPath = pluginSkillRootTreePath(root, rootIndex)

  if (!relativePath) return rootPath

  const encodedRelativePath = relativePath
    .split(/[\\/]+/)
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/")
  return `${rootPath}/${encodedRelativePath}`
}

function isPluginSkillTreePath(path: string) {
  const trimmedPath = path.trim()
  return trimmedPath === PLUGIN_SKILLS_TREE_ROOT_PATH || trimmedPath.startsWith(`${PLUGIN_SKILLS_TREE_ROOT_PATH}/`)
}

function parsePluginSkillTreePath(path: string) {
  const trimmedPath = path.trim()
  const prefix = `${PLUGIN_SKILLS_TREE_ROOT_PATH}/`
  if (!trimmedPath.startsWith(prefix)) return null

  const rawSegments = trimmedPath.slice(prefix.length).split("/").filter(Boolean)
  if (rawSegments.length < 2) return null

  try {
    const pluginID = decodeURIComponent(rawSegments[0]!)
    const rootIndex = Number(rawSegments[1])
    if (!Number.isInteger(rootIndex) || rootIndex < 0) return null

    return {
      pluginID,
      rootIndex,
      relativeSegments: rawSegments.slice(2).map((segment) => decodeURIComponent(segment)),
    }
  } catch {
    return null
  }
}

function resolvePluginSkillTreePath(path: string) {
  const parsed = parsePluginSkillTreePath(path)
  if (!parsed) return null

  const roots = Plugin.listInstalledPluginSkillRoots(null, { includeDisabled: true })
    .filter((root) => root.pluginID === parsed.pluginID)
  const root = roots[parsed.rootIndex]
  if (!root) return null

  const resolvedPath = resolve(root.root, ...parsed.relativeSegments)
  if (!isResolvedPathInsideRoot(root.root, resolvedPath)) return null

  return {
    root,
    path: resolvedPath,
  }
}

async function isSkillFile(path: string) {
  const info = await stat(path).catch(() => null)
  return Boolean(info?.isFile())
}

function toPluginTreeNodeBase(root: Plugin.InstalledPluginSkillRoot) {
  return {
    readOnly: true,
    scope: "plugin" as const,
    pluginID: root.pluginID,
    enabled: root.enabled,
  }
}

async function readPluginSkillResourceTree(
  directory: string,
  root: Plugin.InstalledPluginSkillRoot,
  rootIndex: number,
): Promise<SkillManager.GlobalSkillTreeNode[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  const nodes = await Promise.all(
    entries
      .filter((entry) => !entry.name.startsWith("."))
      .map(async (entry): Promise<SkillManager.GlobalSkillTreeNode> => {
        const entryPath = join(directory, entry.name)

        if (entry.isDirectory()) {
          return {
            ...toPluginTreeNodeBase(root),
            name: entry.name,
            path: pluginSkillTreePath(root, rootIndex, entryPath),
            kind: "directory",
            role: "resource",
            children: await readPluginSkillResourceTree(entryPath, root, rootIndex),
          }
        }

        return {
          ...toPluginTreeNodeBase(root),
          name: entry.name,
          path: pluginSkillTreePath(root, rootIndex, entryPath),
          kind: "file",
          role: "resource",
        }
      }),
  )

  return nodes.toSorted(sortPluginTreeEntries)
}

async function readPluginSkillContainerTree(
  directory: string,
  root: Plugin.InstalledPluginSkillRoot,
  rootIndex: number,
): Promise<SkillManager.GlobalSkillTreeNode[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  const nodes = await Promise.all(
    entries
      .filter((entry) => !entry.name.startsWith("."))
      .map(async (entry): Promise<SkillManager.GlobalSkillTreeNode> => {
        const entryPath = join(directory, entry.name)

        if (entry.isDirectory()) {
          const role = await isSkillFile(join(entryPath, SKILL_FILENAME)) ? "skill" : "folder"
          return {
            ...toPluginTreeNodeBase(root),
            name: entry.name,
            path: pluginSkillTreePath(root, rootIndex, entryPath),
            kind: "directory",
            role,
            children: role === "skill"
              ? await readPluginSkillResourceTree(entryPath, root, rootIndex)
              : await readPluginSkillContainerTree(entryPath, root, rootIndex),
          }
        }

        return {
          ...toPluginTreeNodeBase(root),
          name: entry.name,
          path: pluginSkillTreePath(root, rootIndex, entryPath),
          kind: "file",
          role: "resource",
        }
      }),
  )

  return nodes.toSorted(sortPluginTreeEntries)
}

async function readPluginSkillRootTree(
  root: Plugin.InstalledPluginSkillRoot,
  rootIndex: number,
): Promise<SkillManager.GlobalSkillTreeNode[]> {
  if (await isSkillFile(join(root.root, SKILL_FILENAME))) {
    return [
      {
        ...toPluginTreeNodeBase(root),
        name: basename(root.root),
        path: pluginSkillTreePath(root, rootIndex, root.root),
        kind: "directory",
        role: "skill",
        children: await readPluginSkillResourceTree(root.root, root, rootIndex),
      },
    ]
  }

  return readPluginSkillContainerTree(root.root, root, rootIndex)
}

async function getInstalledPluginSkillTreeNode(): Promise<SkillManager.GlobalSkillTreeNode | null> {
  const roots = Plugin.listInstalledPluginSkillRoots(null, { includeDisabled: true })
  if (roots.length === 0) return null

  const pluginGroups = new Map<string, SkillManager.GlobalSkillTreeNode>()
  const rootIndexesByPluginID = new Map<string, number>()

  for (const root of roots) {
    const rootIndex = rootIndexesByPluginID.get(root.pluginID) ?? 0
    rootIndexesByPluginID.set(root.pluginID, rootIndex + 1)

    const children = await readPluginSkillRootTree(root, rootIndex)
    if (children.length === 0) continue

    const existing = pluginGroups.get(root.pluginID)
    if (existing) {
      existing.children = [...(existing.children ?? []), ...children].toSorted(sortPluginTreeEntries)
      continue
    }

    pluginGroups.set(root.pluginID, {
      name: root.pluginName,
      path: `${PLUGIN_SKILLS_TREE_ROOT_PATH}/${encodeURIComponent(root.pluginID)}`,
      kind: "directory",
      role: "folder",
      readOnly: true,
      scope: "plugin",
      pluginID: root.pluginID,
      enabled: root.enabled,
      children,
    })
  }

  const children = [...pluginGroups.values()].toSorted((left, right) => left.name.localeCompare(right.name))
  if (children.length === 0) return null

  return {
    name: "Plugin skills",
    path: PLUGIN_SKILLS_TREE_ROOT_PATH,
    kind: "directory",
    role: "folder",
    readOnly: true,
    scope: "plugin",
    children,
  }
}

async function readInstalledPluginSkillFile(path: string): Promise<SkillManager.GlobalSkillFileDocument | null> {
  const pluginTreePath = resolvePluginSkillTreePath(path)
  if (pluginTreePath) {
    const fileInfo = await stat(pluginTreePath.path).catch(() => null)
    if (!fileInfo?.isFile()) {
      throw new SkillManager.SkillManagerError("SKILL_FILE_NOT_FOUND", `Skill file '${path}' was not found.`)
    }

    return {
      path: path.trim(),
      content: await readFile(pluginTreePath.path, "utf8"),
      readOnly: true,
      scope: "plugin",
      pluginID: pluginTreePath.root.pluginID,
    }
  }

  if (isPluginSkillTreePath(path)) {
    throw new SkillManager.SkillManagerError("INVALID_SKILL_PATH", `Plugin skill path '${path}' is invalid.`)
  }

  if (!isAbsolute(path)) return null

  const roots = Plugin.listInstalledPluginSkillRoots(null, { includeDisabled: true })
  const resolvedPath = resolve(path)

  for (const root of roots) {
    if (!isResolvedPathInsideRoot(root.root, resolvedPath)) continue

    const fileInfo = await stat(resolvedPath).catch(() => null)
    if (!fileInfo?.isFile()) {
      throw new SkillManager.SkillManagerError("SKILL_FILE_NOT_FOUND", `Skill file '${path}' was not found.`)
    }

    return {
      path: resolvedPath,
      content: await readFile(resolvedPath, "utf8"),
      readOnly: true,
      scope: "plugin",
      pluginID: root.pluginID,
    }
  }

  return null
}

export async function listSkills() {
  return Skill.listGlobal()
}

export async function getSkillTree() {
  const globalTree = await SkillManager.getGlobalSkillTree()
  const pluginTree = await getInstalledPluginSkillTreeNode()

  if (!pluginTree) return globalTree

  return {
    ...globalTree,
    items: [...globalTree.items, pluginTree],
  }
}

export async function readSkillFile(input: z.infer<typeof SkillFileQuery>) {
  try {
    const pluginDocument = await readInstalledPluginSkillFile(input.path)
    if (pluginDocument) return pluginDocument

    return await SkillManager.readGlobalSkillFile(input.path)
  } catch (error) {
    throw toSkillApiError(error)
  }
}

export async function writeSkillFile(input: z.infer<typeof SkillFileBody>) {
  try {
    if (isPluginSkillTreePath(input.path)) {
      throw new SkillManager.SkillManagerError("INVALID_SKILL_PATH", "Plugin skills are read-only.")
    }

    return await SkillManager.writeGlobalSkillFile(input)
  } catch (error) {
    throw toSkillApiError(error)
  }
}

export async function createSkill(input: z.infer<typeof CreateSkillBody>) {
  try {
    return await SkillManager.createGlobalSkill(input)
  } catch (error) {
    throw toSkillApiError(error)
  }
}

export async function renameSkill(input: z.infer<typeof RenameSkillBody>) {
  try {
    return await SkillManager.renameGlobalSkill(input)
  } catch (error) {
    throw toSkillApiError(error)
  }
}

export async function deleteSkill(input: z.infer<typeof DeleteSkillQuery>) {
  try {
    await SkillManager.deleteGlobalSkill(input.directory)
    return {
      directory: input.directory,
      removed: true,
    }
  } catch (error) {
    throw toSkillApiError(error)
  }
}

export async function createSkillFolder(input: z.infer<typeof CreateSkillFolderBody>) {
  try {
    return await SkillManager.createGlobalSkillFolder(input)
  } catch (error) {
    throw toSkillApiError(error)
  }
}

export async function renameSkillFolder(input: z.infer<typeof RenameSkillFolderBody>) {
  try {
    return await SkillManager.renameGlobalSkillFolder(input)
  } catch (error) {
    throw toSkillApiError(error)
  }
}

export async function deleteSkillFolder(input: z.infer<typeof DeleteSkillFolderQuery>) {
  try {
    await SkillManager.deleteGlobalSkillFolder(input.directory)
    return {
      directory: input.directory,
      removed: true,
    }
  } catch (error) {
    throw toSkillApiError(error)
  }
}

export async function moveSkillDirectory(input: z.infer<typeof MoveSkillDirectoryBody>) {
  try {
    return await SkillManager.moveGlobalSkillDirectory(input)
  } catch (error) {
    throw toSkillApiError(error)
  }
}

export async function previewSkillGitInstall(input: z.infer<typeof PreviewSkillGitInstallBody>) {
  try {
    return await SkillGitInstall.previewGlobalSkillGitInstall(input.source, input.parentDirectory)
  } catch (error) {
    throw toSkillApiError(error)
  }
}

export async function installSkillGitPreview(input: z.infer<typeof InstallSkillGitPreviewBody>) {
  try {
    return await SkillGitInstall.installGlobalSkillsFromGitPreview(input)
  } catch (error) {
    throw toSkillApiError(error)
  }
}

export async function installSkillLocalFile(input: z.infer<typeof InstallSkillLocalFileBody>) {
  try {
    return await SkillGitInstall.installGlobalSkillFromLocalPath(input.sourcePath, input.parentDirectory)
  } catch (error) {
    throw toSkillApiError(error)
  }
}
