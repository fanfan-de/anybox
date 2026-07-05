import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import {
  type CinemaCanvasDocument,
  type CinemaGenerationTask,
  type CinemaProviderAuthState,
  type TestCinemaVideoProviderConnectionBody,
  type CinemaVideoProvider,
  type CinemaVideoProviderManifest,
  CinemaGenerationModeSchema,
  CinemaVideoProviderManifestSchema,
  type CreateCinemaGenerationTaskBody,
} from "@anybox/shared/cinema"
import * as ProviderAuth from "#auth/provider-auth.ts"
import * as Config from "#config/config.ts"
import * as Global from "#global/global.ts"
import * as Installation from "#installation/installation.ts"
import { ApiError } from "#server/error.ts"
import * as Log from "#util/log.ts"

const PROVIDERS_MODELSWIKI_API_URL =
  "https://raw.githubusercontent.com/fanfan-de/Providers-ModelsWiki/main/dist/api.json"
const REQUEST_TIMEOUT_MS = 10 * 1000
const CATALOG_SOURCE_ID = "providers-modelswiki"

const log = Log.create({ service: "cinema-video-provider-catalog" })

export type ProviderAdapterCreateInput = {
  root: string
  cinemaRoot: string
  task: CinemaGenerationTask
  canvas: CinemaCanvasDocument
}

export type ProviderAdapterRefreshInput = ProviderAdapterCreateInput

export type ProviderAdapter = {
  manifest: CinemaVideoProviderManifest
  createTask: (input: ProviderAdapterCreateInput) => Promise<CinemaGenerationTask>
  refreshTask: (input: ProviderAdapterRefreshInput) => Promise<CinemaGenerationTask>
  cancelTask?: (input: ProviderAdapterRefreshInput) => Promise<CinemaGenerationTask>
}

const RawCatalogModelSchema = z
  .object({
    id: z.string().min(1),
    catalog_id: z.string().min(1).optional(),
    name: z.string().min(1),
    family: z.string().min(1).optional(),
    lab: z.string().min(1).optional(),
    base_model: z.string().min(1).optional(),
    endpoint_type: z.string().min(1).optional(),
    modalities: z
      .object({
        input: z.array(z.string().min(1)).default([]),
        output: z.array(z.string().min(1)).default([]),
      })
      .optional(),
    modes: z.array(z.string().min(1)).default([]),
    audio_output: z.boolean().optional(),
    pricing: z.array(z.record(z.string(), z.unknown())).default([]),
    limit: z
      .object({
        durations: z.array(z.number()).default([]),
        resolutions: z.array(z.string().min(1)).default([]),
        aspect_ratios: z.array(z.string().min(1)).default([]),
        max_duration_seconds: z.number().positive().optional(),
      })
      .optional(),
    source_url: z.string().min(1).optional(),
    source_checked_at: z.string().min(1).optional(),
  })
  .passthrough()

const RawCatalogConnectionTestMethodSchema = z.preprocess(
  (value) => typeof value === "string" ? value.trim().toUpperCase() : value,
  z.enum(["GET", "POST", "HEAD"]),
).default("GET")

const RawCatalogConnectionTestAuthSchema = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value
    return value.trim().toLowerCase().replace(/_/g, "-")
  },
  z.enum(["bearer", "x-api-key", "query", "none"]),
).default("bearer")

const RawCatalogConnectionTestSchema = z
  .object({
    method: RawCatalogConnectionTestMethodSchema,
    url: z.string().min(1).optional(),
    path: z.string().min(1).optional(),
    auth: RawCatalogConnectionTestAuthSchema,
    api_key_header: z.string().min(1).optional(),
    api_key_query_param: z.string().min(1).optional(),
    headers: z.record(z.string(), z.string()).default({}),
    body: z.unknown().optional(),
    expected_status: z.array(z.number().int().min(100).max(599)).default([200]),
    timeout_ms: z.number().int().positive().max(REQUEST_TIMEOUT_MS * 3).default(REQUEST_TIMEOUT_MS),
  })
  .passthrough()

const RawCatalogProviderSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    kind: z.string().min(1).optional(),
    base_url: z.string().min(1).optional(),
    website: z.string().min(1).optional(),
    doc: z.string().min(1).optional(),
    regions: z.array(z.string().min(1)).default([]),
    auth_type: z.string().min(1).optional(),
    connection_test: RawCatalogConnectionTestSchema.optional(),
    models: z.record(z.string(), RawCatalogModelSchema).default({}),
  })
  .passthrough()

const RawCatalogSchema = z.record(z.string(), RawCatalogProviderSchema)
type RawCatalog = z.infer<typeof RawCatalogSchema>

type CinemaVideoProviderConnectionTestResult = {
  providerID: string
  ok: boolean
  status:
    | "working"
    | "not_connected"
    | "auth_error"
    | "network_error"
    | "config_error"
    | "unsupported"
    | "unknown_error"
  checkedAt: number
  message: string
  errorCode?: string
  diagnostics?: Record<string, unknown>
}

type CacheSnapshot = {
  data: RawCatalog
  signature?: string
}

let catalogOverride: RawCatalog | undefined
let cachedCatalog: RawCatalog | undefined
let loadedCacheSignature: string | undefined
let cacheFilePathOverride: string | undefined

function cacheFilePath() {
  return cacheFilePathOverride ?? path.join(Global.Path.cache, "cinema-video-providers.json")
}

async function readCache(): Promise<CacheSnapshot | undefined> {
  const filepath = cacheFilePath()
  const signature = await stat(filepath)
    .then((fileStat) => `${fileStat.mtimeMs}:${fileStat.size}`)
    .catch(() => undefined)
  const text = await readFile(filepath, "utf8").catch(() => undefined)
  if (!text) return undefined

  try {
    return {
      data: RawCatalogSchema.parse(JSON.parse(text)),
      signature,
    }
  } catch (error) {
    log.error("Failed to parse cached Cinema video provider catalog", { error })
    return undefined
  }
}

async function invalidateIfCacheChanged() {
  if (!loadedCacheSignature) return
  const filepath = cacheFilePath()
  const currentSignature = await stat(filepath)
    .then((fileStat) => `${fileStat.mtimeMs}:${fileStat.size}`)
    .catch(() => undefined)
  if (!currentSignature || currentSignature === loadedCacheSignature) return

  loadedCacheSignature = undefined
  cachedCatalog = undefined
}

async function fetchRemoteCatalog(): Promise<RawCatalog> {
  const response = await fetch(PROVIDERS_MODELSWIKI_API_URL, {
    headers: {
      "User-Agent": Installation.USER_AGENT,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (!response.ok) {
    throw new Error(`Providers-ModelsWiki request failed with status ${response.status}`)
  }

  const text = await response.text()
  const parsed = RawCatalogSchema.parse(JSON.parse(text))
  const filepath = cacheFilePath()
  await mkdir(path.dirname(filepath), { recursive: true })
  await writeFile(filepath, text)
  loadedCacheSignature = await stat(filepath)
    .then((fileStat) => `${fileStat.mtimeMs}:${fileStat.size}`)
    .catch(() => undefined)
  cachedCatalog = parsed
  return parsed
}

async function loadRawCatalog(): Promise<RawCatalog> {
  if (catalogOverride) return catalogOverride
  await invalidateIfCacheChanged()
  if (cachedCatalog) return cachedCatalog

  const cached = await readCache()
  if (cached) {
    loadedCacheSignature = cached.signature
    cachedCatalog = cached.data
    return cached.data
  }

  try {
    return await fetchRemoteCatalog()
  } catch (error) {
    log.error("Failed to load Cinema video provider catalog", { error })
    const fallback = await readCache()
    if (fallback) {
      loadedCacheSignature = fallback.signature
      cachedCatalog = fallback.data
      return fallback.data
    }
    throw error
  }
}

export async function refreshCinemaVideoProviderCatalog(): Promise<CinemaVideoProvider[]> {
  if (catalogOverride) {
    cachedCatalog = catalogOverride
  } else {
    await fetchRemoteCatalog()
  }
  return await listCinemaVideoProviders()
}

export function setCinemaVideoProviderCatalogForTest(catalog: RawCatalog | undefined) {
  const previous = catalogOverride
  catalogOverride = catalog
  cachedCatalog = undefined
  loadedCacheSignature = undefined
  return () => {
    catalogOverride = previous
    cachedCatalog = undefined
    loadedCacheSignature = undefined
  }
}

export function setCinemaVideoProviderCatalogCacheFileForTest(filepath: string | undefined) {
  const previous = cacheFilePathOverride
  cacheFilePathOverride = filepath
  cachedCatalog = undefined
  loadedCacheSignature = undefined
  return () => {
    cacheFilePathOverride = previous
    cachedCatalog = undefined
    loadedCacheSignature = undefined
  }
}

function normalizeBaseURL(value: string | null | undefined) {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new ApiError(400, "CINEMA_PROVIDER_BASE_URL_INVALID", "Video provider base URL must be a valid absolute URL.")
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ApiError(400, "CINEMA_PROVIDER_BASE_URL_INVALID", "Video provider base URL must use http or https.")
  }
  url.hash = ""
  url.search = ""
  return url.toString().replace(/\/$/, "")
}

function normalizeCatalogBaseURL(value: string | null | undefined) {
  try {
    return normalizeBaseURL(value)
  } catch (error) {
    log.warn("Ignoring invalid Cinema video provider catalog base URL", { value, error })
    return undefined
  }
}

function normalizeNumberList(values: number[] | undefined) {
  return [...new Set((values ?? []).filter((value) => Number.isFinite(value) && value > 0))]
}

function normalizeStringList(values: string[] | undefined) {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))]
}

function normalizeModes(values: string[]) {
  return values.flatMap((value) => {
    const parsed = CinemaGenerationModeSchema.safeParse(value)
    return parsed.success ? [parsed.data] : []
  })
}

function manifestFromCatalogProvider(provider: RawCatalogProviderSchemaOutput): CinemaVideoProviderManifest {
  const models = Object.values(provider.models)
    .map((model) => {
      const modes = normalizeModes(model.modes)
      if (modes.length === 0) return null
      return {
        id: model.id,
        label: model.name,
        ...(model.catalog_id ? { catalogID: model.catalog_id } : {}),
        ...(model.family ? { family: model.family } : {}),
        ...(model.lab ? { lab: model.lab } : {}),
        ...(model.base_model ? { baseModel: model.base_model } : {}),
        ...(model.endpoint_type ? { endpointType: model.endpoint_type } : {}),
        ...(model.modalities
          ? {
              modalities: {
                input: normalizeStringList(model.modalities.input),
                output: normalizeStringList(model.modalities.output),
              },
            }
          : {}),
        modes,
        durations: normalizeNumberList(model.limit?.durations),
        aspectRatios: normalizeStringList(model.limit?.aspect_ratios),
        resolutions: normalizeStringList(model.limit?.resolutions),
        ...(model.limit?.max_duration_seconds ? { maxDurationSeconds: model.limit.max_duration_seconds } : {}),
        pricing: model.pricing,
        ...(model.source_url ? { sourceURL: model.source_url } : {}),
        ...(model.source_checked_at ? { sourceCheckedAt: model.source_checked_at } : {}),
        ...(model.audio_output ? { supportsAudio: true } : {}),
        parameterSchema: {},
      }
    })
    .filter((model): model is NonNullable<typeof model> => Boolean(model))

  return CinemaVideoProviderManifestSchema.parse({
    id: provider.id,
    name: provider.name,
    description: provider.doc ? `Video generation provider cataloged from ${provider.doc}` : undefined,
    kind: provider.kind,
    baseURL: provider.base_url,
    website: provider.website,
    doc: provider.doc,
    regions: normalizeStringList(provider.regions),
    authType: provider.auth_type,
    catalogSource: CATALOG_SOURCE_ID,
    credentialProviderID: `cinema-${provider.id}`,
    requiresCredential: provider.auth_type !== undefined,
    ...(provider.connection_test
      ? {
          connectionTest: {
            method: provider.connection_test.method,
            url: provider.connection_test.url,
            path: provider.connection_test.path,
            auth: provider.connection_test.auth,
            apiKeyHeader: provider.connection_test.api_key_header,
            apiKeyQueryParam: provider.connection_test.api_key_query_param,
            headers: provider.connection_test.headers,
            body: provider.connection_test.body,
            expectedStatus: provider.connection_test.expected_status,
            timeoutMs: provider.connection_test.timeout_ms,
          },
        }
      : {}),
    models,
  })
}

type RawCatalogProviderSchemaOutput = z.infer<typeof RawCatalogProviderSchema>

async function catalogManifests(): Promise<CinemaVideoProviderManifest[]> {
  const catalog = await loadRawCatalog()
  return Object.values(catalog)
    .map(manifestFromCatalogProvider)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
}

const providerAdapters: Record<string, ProviderAdapter> = {}

export function assertCinemaVideoProviderModelSupports(
  input: CreateCinemaGenerationTaskBody,
  manifest: CinemaVideoProviderManifest,
) {
  const model = manifest.models.find((item) => item.id === input.modelID)
  if (!model) {
    throw new ApiError(400, "CINEMA_PROVIDER_MODEL_NOT_FOUND", `Cinema provider '${manifest.id}' does not expose model '${input.modelID}'.`)
  }
  if (!model.modes.includes(input.mode)) {
    throw new ApiError(400, "CINEMA_PROVIDER_MODE_UNSUPPORTED", `Model '${input.modelID}' does not support mode '${input.mode}'.`)
  }
}

export function getCinemaVideoProviderAdapter(providerID: string): ProviderAdapter {
  const adapter = providerAdapters[providerID]
  if (!adapter) {
    throw new ApiError(
      501,
      "CINEMA_PROVIDER_RUNTIME_UNAVAILABLE",
      `Cinema video provider '${providerID}' is available in the catalog but does not have a generation runtime adapter yet.`,
    )
  }
  return adapter
}

async function providerAuthStateFor(manifest: CinemaVideoProviderManifest): Promise<CinemaProviderAuthState> {
  const credentialProviderID = manifest.credentialProviderID ?? `cinema-${manifest.id}`
  if (!manifest.requiresCredential) {
    return {
      providerID: manifest.id,
      credentialProviderID,
      requiresCredential: false,
      connected: true,
      status: "connected",
    }
  }

  const runtimeAuth = await ProviderAuth.resolveProviderRuntimeAuth(credentialProviderID, {}, {
    method: "api-key",
    credentialMode: "active",
  })
  const connected = Boolean(runtimeAuth.apiKey)
  return {
    providerID: manifest.id,
    credentialProviderID,
    requiresCredential: true,
    connected,
    status: connected ? "connected" : runtimeAuth.authState.status,
    credentialKind: runtimeAuth.credentialKind,
    credentialSource: runtimeAuth.credentialSource,
    connectionLabel: runtimeAuth.authState.connectionLabel,
    lastError: runtimeAuth.authState.lastError,
  }
}

async function providerRuntimeFor(manifest: CinemaVideoProviderManifest): Promise<CinemaVideoProvider["runtime"]> {
  const settings = await Config.getCinemaVideoProviderSettings(manifest.id)
  const configuredBaseURL = normalizeBaseURL(settings.baseURL)
  if (configuredBaseURL) {
    return {
      baseURL: configuredBaseURL,
      configuredBaseURL,
      baseURLSource: "settings",
    }
  }

  const catalogBaseURL = normalizeCatalogBaseURL(manifest.baseURL)
  if (!catalogBaseURL) return undefined
  return {
    baseURL: catalogBaseURL,
    baseURLSource: "default",
  }
}

async function videoProviderFor(manifest: CinemaVideoProviderManifest): Promise<CinemaVideoProvider> {
  const runtime = await providerRuntimeFor(manifest)
  return {
    manifest,
    auth: await providerAuthStateFor(manifest),
    ...(runtime ? { runtime } : {}),
  }
}

export async function listCinemaVideoProviders(): Promise<CinemaVideoProvider[]> {
  return await Promise.all((await catalogManifests()).map(videoProviderFor))
}

export async function getCinemaVideoProvider(providerID: string): Promise<CinemaVideoProvider> {
  const manifest = (await catalogManifests()).find((item) => item.id === providerID)
  if (!manifest) {
    throw new ApiError(404, "CINEMA_PROVIDER_NOT_FOUND", `Cinema video provider '${providerID}' was not found.`)
  }
  return await videoProviderFor(manifest)
}

export async function getCinemaVideoProviderAuth(providerID: string): Promise<CinemaProviderAuthState> {
  return (await getCinemaVideoProvider(providerID)).auth
}

export async function saveCinemaVideoProviderApiKey(providerID: string, apiKey: string | null | undefined): Promise<CinemaProviderAuthState> {
  const provider = await getCinemaVideoProvider(providerID)
  if (!provider.manifest.requiresCredential || !provider.manifest.credentialProviderID) {
    throw new ApiError(400, "CINEMA_PROVIDER_CREDENTIAL_UNSUPPORTED", `Cinema provider '${providerID}' does not use API key credentials.`)
  }
  await ProviderAuth.saveProviderApiKey(provider.manifest.credentialProviderID, apiKey)
  return await providerAuthStateFor(provider.manifest)
}

export async function saveCinemaVideoProviderSettings(
  providerID: string,
  input: { baseURL?: string | null },
): Promise<CinemaVideoProvider> {
  const provider = await getCinemaVideoProvider(providerID)
  const baseURL = normalizeBaseURL(input.baseURL)
  await Config.setCinemaVideoProviderSettings(Config.GLOBAL_CONFIG_ID, provider.manifest.id, {
    ...(baseURL ? { baseURL } : {}),
  })
  return await videoProviderFor(provider.manifest)
}

function createConnectionTestResult(
  providerID: string,
  result: Omit<CinemaVideoProviderConnectionTestResult, "providerID" | "checkedAt">,
): CinemaVideoProviderConnectionTestResult {
  return {
    providerID,
    checkedAt: Date.now(),
    ...result,
  }
}

function requestURLForConnectionTest(
  manifest: CinemaVideoProviderManifest,
  runtime: CinemaVideoProvider["runtime"],
  input: TestCinemaVideoProviderConnectionBody,
) {
  const test = manifest.connectionTest
  if (!test) return undefined

  const configuredBaseURL = input.baseURL?.trim() ? normalizeBaseURL(input.baseURL) : undefined
  const baseURL = configuredBaseURL ?? runtime?.baseURL ?? normalizeCatalogBaseURL(manifest.baseURL)
  const urlOrPath = test.url ?? test.path
  if (!urlOrPath) return undefined

  try {
    return new URL(urlOrPath)
  } catch {
    if (!baseURL) return undefined
    const normalizedPath = urlOrPath.replace(/^\/+/, "")
    return new URL(normalizedPath, `${baseURL}/`)
  }
}

function sanitizedConnectionTestURL(url: URL) {
  const sanitized = new URL(url)
  sanitized.username = ""
  sanitized.password = ""
  sanitized.search = ""
  sanitized.hash = ""
  return sanitized.toString()
}

async function apiKeyForConnectionTest(
  manifest: CinemaVideoProviderManifest,
  input: TestCinemaVideoProviderConnectionBody,
) {
  if (!manifest.requiresCredential) return undefined

  if (input.apiKey !== undefined) {
    const transientApiKey = input.apiKey?.trim()
    return transientApiKey || undefined
  }

  const credentialProviderID = manifest.credentialProviderID ?? `cinema-${manifest.id}`
  const runtimeAuth = await ProviderAuth.resolveProviderRuntimeAuth(credentialProviderID, {}, {
    method: "api-key",
    credentialMode: "active",
  })
  return runtimeAuth.apiKey?.trim() || undefined
}

function applyConnectionTestAuth(
  url: URL,
  headers: Headers,
  manifest: CinemaVideoProviderManifest,
  apiKey: string | undefined,
) {
  const test = manifest.connectionTest
  if (!test || !apiKey || test.auth === "none") return

  if (test.auth === "query") {
    url.searchParams.set(test.apiKeyQueryParam ?? "api_key", apiKey)
    return
  }

  if (test.auth === "x-api-key") {
    headers.set(test.apiKeyHeader ?? "X-API-Key", apiKey)
    return
  }

  headers.set("Authorization", `Bearer ${apiKey}`)
}

function classifyConnectionTestStatus(status: number) {
  if (status === 401 || status === 403) return "auth_error" as const
  if (status >= 500) return "network_error" as const
  return "config_error" as const
}

function classifyConnectionTestError(error: unknown) {
  if (error instanceof ApiError) {
    return {
      status: "config_error" as const,
      message: error.message,
      errorCode: error.code,
    }
  }

  if (error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return {
      status: "network_error" as const,
      message: "连接测试超时。请检查 endpoint 或网络连接。",
      errorCode: error.name,
    }
  }

  const message = error instanceof Error && error.message.trim() ? error.message : String(error)
  if (/fetch|network|ECONN|ENOTFOUND|ETIMEDOUT|EAI_AGAIN/i.test(message)) {
    return {
      status: "network_error" as const,
      message: "连接测试失败：无法连接到测试端点。",
      diagnostics: { cause: message },
    }
  }

  return {
    status: "unknown_error" as const,
    message: message || "连接测试失败。",
  }
}

export async function testCinemaVideoProviderConnection(
  providerID: string,
  input: TestCinemaVideoProviderConnectionBody = {},
): Promise<CinemaVideoProviderConnectionTestResult> {
  const provider = await getCinemaVideoProvider(providerID)
  const { manifest, runtime } = provider
  const test = manifest.connectionTest
  if (!test) {
    return createConnectionTestResult(providerID, {
      ok: false,
      status: "unsupported",
      message: "这个视频服务商的 catalog 暂未声明低成本测试端点。",
    })
  }

  try {
    const apiKey = await apiKeyForConnectionTest(manifest, input)
    if (manifest.requiresCredential && !apiKey) {
      return createConnectionTestResult(providerID, {
        ok: false,
        status: "not_connected",
        message: "未找到可用连接。请先保存或输入 API key。",
      })
    }

    const url = requestURLForConnectionTest(manifest, runtime, input)
    if (!url) {
      return createConnectionTestResult(providerID, {
        ok: false,
        status: "config_error",
        message: "catalog 已声明测试端点，但没有可用的 Base URL 或测试 URL。",
      })
    }

    const headers = new Headers(test.headers)
    applyConnectionTestAuth(url, headers, manifest, apiKey)
    const hasBody = test.method !== "GET" && test.method !== "HEAD" && test.body !== undefined
    if (hasBody && !headers.has("content-type")) {
      headers.set("content-type", "application/json")
    }

    const response = await fetch(url, {
      method: test.method,
      headers,
      ...(hasBody ? { body: JSON.stringify(test.body) } : {}),
      signal: AbortSignal.timeout(test.timeoutMs),
    })
    const diagnostics = {
      method: test.method,
      url: sanitizedConnectionTestURL(url),
      status: response.status,
    }
    if (test.expectedStatus.includes(response.status)) {
      return createConnectionTestResult(providerID, {
        ok: true,
        status: "working",
        message: "连接测试成功。",
        diagnostics,
      })
    }

    const status = classifyConnectionTestStatus(response.status)
    return createConnectionTestResult(providerID, {
      ok: false,
      status,
      message:
        status === "auth_error"
          ? `连接测试失败：远端返回 HTTP ${response.status}。请检查 API key。`
          : `连接测试失败：远端返回 HTTP ${response.status}。`,
      diagnostics,
    })
  } catch (error) {
    const classified = classifyConnectionTestError(error)
    return createConnectionTestResult(providerID, {
      ok: false,
      ...classified,
    })
  }
}

export async function hasConnectedCinemaVideoProvider() {
  for (const provider of await listCinemaVideoProviders()) {
    if (!provider.manifest.requiresCredential) continue
    if (provider.auth.connected) return true
  }
  return false
}
