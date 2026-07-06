import { createHmac } from "node:crypto"
import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import {
  type CinemaCanvasDocument,
  type CinemaGeneratedAsset,
  type CinemaGenerationTask,
  type CinemaProviderAuthState,
  type CinemaProviderModelMode,
  type TestCinemaVideoProviderConnectionBody,
  type CinemaVideoProvider,
  type CinemaVideoProviderManifest,
  CinemaProviderModelModeSchema,
  CinemaVideoProviderManifestSchema,
  type CreateCinemaGenerationTaskBody,
} from "@anybox/shared/cinema"
import * as ProviderAuth from "#auth/provider-auth.ts"
import * as Config from "#config/config.ts"
import * as Global from "#global/global.ts"
import * as Installation from "#installation/installation.ts"
import { ApiError } from "#server/error.ts"
import {
  isSupportedImageMime,
  readImageDimensions,
} from "#session/support/image-assets.ts"
import * as Log from "#util/log.ts"

const PROVIDERS_MODELSWIKI_API_URL =
  "https://raw.githubusercontent.com/fanfan-de/Providers-ModelsWiki/main/dist/api.json"
const REQUEST_TIMEOUT_MS = 10 * 1000
const CATALOG_SOURCE_ID = "providers-modelswiki"
const KLINGAI_PROVIDER_ID = "klingai"
const KLINGAI_DEFAULT_BASE_URL = "https://api-singapore.klingai.com"
const KLINGAI_REQUEST_TIMEOUT_MS = 30 * 1000
const KLINGAI_DOWNLOAD_TIMEOUT_MS = 120 * 1000
const KLINGAI_IMAGE_ASSET_MAX_BYTES = 25 * 1024 * 1024
const KLINGAI_VIDEO_ASSET_MAX_BYTES = 256 * 1024 * 1024
const IMAGE_EXTENSION_BY_MIME: Record<string, string> = {
  "image/apng": ".png",
  "image/avif": ".avif",
  "image/bmp": ".bmp",
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/svg+xml": ".svg",
  "image/webp": ".webp",
}
const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  ".apng": "image/apng",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
}
const VIDEO_EXTENSION_BY_MIME: Record<string, string> = {
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
}
const VIDEO_MIME_BY_EXTENSION: Record<string, string> = {
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
}

const log = Log.create({ service: "cinema-video-provider-catalog" })

export type ProviderAdapterCreateInput = {
  root: string
  cinemaRoot: string
  task: CinemaGenerationTask
  canvas: CinemaCanvasDocument
}

export type ProviderAdapterRefreshInput = ProviderAdapterCreateInput
export type ProviderAdapterCallbackInput = ProviderAdapterCreateInput & {
  payload: unknown
}

export type ProviderAdapter = {
  manifest: CinemaVideoProviderManifest
  supportedModes?: readonly CinemaProviderModelMode[]
  createTask: (input: ProviderAdapterCreateInput) => Promise<CinemaGenerationTask>
  refreshTask: (input: ProviderAdapterRefreshInput) => Promise<CinemaGenerationTask>
  receiveCallback?: (input: ProviderAdapterCallbackInput) => Promise<CinemaGenerationTask>
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
    const parsed = CinemaProviderModelModeSchema.safeParse(value)
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

export function registerCinemaVideoProviderAdapter(providerID: string, adapter: ProviderAdapter) {
  providerAdapters[providerID] = adapter
}

export function hasCinemaVideoProviderAdapter(providerID: string) {
  return Boolean(providerAdapters[providerID])
}

export function cinemaVideoProviderAdapterSupportsMode(providerID: string, mode: CinemaProviderModelMode) {
  const adapter = providerAdapters[providerID]
  if (!adapter) return false
  if (adapter.supportedModes) return adapter.supportedModes.includes(mode)
  return mode === "text-to-video" || mode === "image-to-video"
}

export function findCinemaVideoProviderModelForMode(
  manifest: CinemaVideoProviderManifest,
  modelID: string,
  mode: CinemaProviderModelMode,
) {
  return manifest.models.find((item) => item.id === modelID && item.modes.includes(mode))
    ?? manifest.models.find((item) => item.id === modelID)
}

function unregisterCinemaVideoProviderAdapter(providerID: string) {
  delete providerAdapters[providerID]
}

export function setCinemaVideoProviderAdapterForTest(providerID: string, adapter: ProviderAdapter | undefined) {
  const previous = providerAdapters[providerID]
  if (adapter) {
    registerCinemaVideoProviderAdapter(providerID, adapter)
  } else {
    unregisterCinemaVideoProviderAdapter(providerID)
  }

  return () => {
    if (previous) {
      registerCinemaVideoProviderAdapter(providerID, previous)
    } else {
      unregisterCinemaVideoProviderAdapter(providerID)
    }
  }
}

type KlingAIEndpointKind = "text2video" | "image2video" | "image-generation"

type KlingAIVideoResult = {
  id?: string
  url: string
}

type KlingAIImageResult = {
  id?: string
  url: string
}

type KlingAIParsedResponse = {
  message?: string
  data?: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function numberOrStringValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return stringValue(value)
}

function taskUpdated(task: CinemaGenerationTask, patch: Partial<CinemaGenerationTask>): CinemaGenerationTask {
  return {
    ...task,
    ...patch,
    updatedAt: new Date().toISOString(),
  }
}

function base64URL(input: string | Buffer) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
}

function createKlingAIJWT(input: { accessKey: string; secretKey: string }) {
  const nowSeconds = Math.floor(Date.now() / 1000)
  const header = base64URL(JSON.stringify({ alg: "HS256", typ: "JWT" }))
  const payload = base64URL(JSON.stringify({
    iss: input.accessKey,
    exp: nowSeconds + 1800,
    nbf: nowSeconds - 5,
  }))
  const signature = createHmac("sha256", input.secretKey)
    .update(`${header}.${payload}`)
    .digest()
  return `${header}.${payload}.${base64URL(signature)}`
}

function unquoteCredentialValue(value: string) {
  const trimmed = value.trim()
  const match = /^["'](.+)["']$/.exec(trimmed)
  return (match?.[1] ?? trimmed).trim()
}

function stripKlingAICredentialDecorators(value: string) {
  return unquoteCredentialValue(
    value
      .trim()
      .replace(/^authorization\s*:\s*/i, "")
      .replace(/^bearer\s+/i, ""),
  )
}

function firstCredentialCapture(value: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = pattern.exec(value)
    const captured = match?.[1] ? unquoteCredentialValue(match[1]) : undefined
    if (captured) return captured
  }
  return undefined
}

function maybeSingleLabeledKlingAIAPIKey(value: string) {
  const match = /^(?:api\s*key|apikey)\s*[:=]\s*(.+)$/i.exec(value.trim())
  return match?.[1] ? stripKlingAICredentialDecorators(match[1]) : undefined
}

function maybeKlingAICredentialPair(value: string) {
  const trimmed = stripKlingAICredentialDecorators(value)
  if (!trimmed) return undefined

  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed)
      if (isRecord(parsed)) {
        const accessKey = stringValue(parsed.accessKey) ?? stringValue(parsed.access_key) ?? stringValue(parsed.ak)
        const secretKey = stringValue(parsed.secretKey) ?? stringValue(parsed.secret_key) ?? stringValue(parsed.sk)
        if (accessKey && secretKey) return { accessKey, secretKey }
      }
    } catch {
      return undefined
    }
  }

  const labeledAccessKey = firstCredentialCapture(trimmed, [
    /\baccess\s*key\s*id\s*[:=]\s*([^\s,;]+)/i,
    /\baccess\s*key\s*[:=]\s*([^\s,;]+)/i,
    /\baccess[_-]?key[_-]?id\s*[:=]\s*([^\s,;]+)/i,
    /\baccess[_-]?key\s*[:=]\s*([^\s,;]+)/i,
    /\baccessKey(?:ID|Id)?\s*[:=]\s*([^\s,;]+)/,
    /\bak\s*[:=]\s*([^\s,;]+)/i,
  ])
  const labeledSecretKey = firstCredentialCapture(trimmed, [
    /\baccess\s*key\s*secret\s*[:=]\s*([^\s,;]+)/i,
    /\bsecret\s*key\s*[:=]\s*([^\s,;]+)/i,
    /\baccess[_-]?key[_-]?secret\s*[:=]\s*([^\s,;]+)/i,
    /\bsecret[_-]?key\s*[:=]\s*([^\s,;]+)/i,
    /\bsecretKey\s*[:=]\s*([^\s,;]+)/,
    /\bsk\s*[:=]\s*([^\s,;]+)/i,
  ])
  if (labeledAccessKey && labeledSecretKey) {
    return {
      accessKey: labeledAccessKey,
      secretKey: labeledSecretKey,
    }
  }

  const lines = trimmed.split(/\r?\n/).map(stripKlingAICredentialDecorators).filter(Boolean)
  if (lines.length === 2 && !lines.some((line) => /[:=]/.test(line))) {
    return {
      accessKey: lines[0]!,
      secretKey: lines[1]!,
    }
  }

  const separator = trimmed.includes(":") ? ":" : trimmed.includes("|") ? "|" : trimmed.includes(",") ? "," : null
  if (!separator) return undefined
  const [rawAccessKey, ...secretParts] = trimmed.split(separator)
  const accessKey = rawAccessKey?.trim() ?? ""
  const secretKey = secretParts.join(separator).trim()
  if (!accessKey || !secretKey) return undefined
  return {
    accessKey,
    secretKey,
  }
}

function isJWTLike(value: string) {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(stripKlingAICredentialDecorators(value))
}

async function klingAIBearerToken() {
  const runtimeAuth = await ProviderAuth.resolveProviderRuntimeAuth(`cinema-${KLINGAI_PROVIDER_ID}`, {}, {
    method: "api-key",
    credentialMode: "active",
  })
  const apiKey = runtimeAuth.apiKey?.trim()
  if (!apiKey) {
    throw new ApiError(
      401,
      "CINEMA_KLINGAI_AUTH_MISSING",
      "KlingAI requires credentials. Save a JWT token, ACCESS_KEY:SECRET_KEY, or JSON with accessKey/secretKey.",
    )
  }

  const normalizedApiKey = maybeSingleLabeledKlingAIAPIKey(apiKey) ?? stripKlingAICredentialDecorators(apiKey)
  if (isJWTLike(normalizedApiKey)) return normalizedApiKey
  const pair = maybeKlingAICredentialPair(apiKey)
  return pair ? createKlingAIJWT(pair) : normalizedApiKey
}

async function klingAIBaseURL() {
  const settings = await Config.getCinemaVideoProviderSettings(KLINGAI_PROVIDER_ID)
  const configuredBaseURL = normalizeBaseURL(settings.baseURL)
  if (configuredBaseURL) return configuredBaseURL

  const manifest = (await catalogManifests()).find((item) => item.id === KLINGAI_PROVIDER_ID)
  return normalizeCatalogBaseURL(manifest?.baseURL) ?? KLINGAI_DEFAULT_BASE_URL
}

function defaultBaseURLForProvider(manifest: CinemaVideoProviderManifest) {
  return (
    normalizeCatalogBaseURL(manifest.baseURL) ??
    (manifest.id === KLINGAI_PROVIDER_ID ? KLINGAI_DEFAULT_BASE_URL : undefined)
  )
}

function klingAIEndpointPath(kind: KlingAIEndpointKind, taskID?: string) {
  const basePath = kind === "image-generation" ? "v1/images/generations" : `v1/videos/${kind}`
  if (!taskID) return basePath
  return `${basePath}/${encodeURIComponent(taskID)}`
}

function klingAIURL(baseURL: string, endpointPath: string) {
  const normalizedEndpoint = endpointPath.replace(/^\/+/, "")
  const base = new URL(`${baseURL}/`)
  const baseHasVersion = base.pathname.replace(/\/+$/, "").endsWith("/v1")
  const relativeEndpoint = baseHasVersion ? normalizedEndpoint.replace(/^v1\/+/, "") : normalizedEndpoint
  return new URL(relativeEndpoint, base).toString()
}

function redactKlingAIErrorText(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/("(?:authorization|api[_-]?key|access[_-]?key|secret[_-]?key|ak|sk)"\s*:\s*)"[^"]+"/gi, "$1\"[redacted]\"")
    .slice(0, 1000)
}

function parseKlingAIJSON(text: string): Record<string, unknown> {
  if (!text.trim()) return {}
  try {
    const parsed = JSON.parse(text)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {
      message: text,
    }
  }
}

function klingAIAPIErrorCode(status: number) {
  if (status === 401 || status === 403) return "CINEMA_KLINGAI_AUTH_FAILED"
  if (status === 429) return "CINEMA_KLINGAI_RATE_LIMITED"
  return "CINEMA_KLINGAI_REQUEST_FAILED"
}

function klingAIRequestErrorMessage(status: number, remoteMessage: string) {
  const detail = remoteMessage ? `: ${redactKlingAIErrorText(remoteMessage)}` : "."
  if (status === 401 || status === 403) {
    return `KlingAI rejected the saved credential with HTTP ${status}${detail} Save the full API Key, or for legacy Access Key credentials save AccessKeyID:AccessKeySecret without the Bearer prefix.`
  }
  return `KlingAI request failed with HTTP ${status}${detail}`
}

async function requestKlingAI(
  endpointPath: string,
  options: {
    method?: "GET" | "POST"
    body?: Record<string, unknown>
  } = {},
): Promise<KlingAIParsedResponse> {
  const baseURL = await klingAIBaseURL()
  const token = await klingAIBearerToken()
  const headers = new Headers({
    Authorization: `Bearer ${token}`,
  })
  if (options.body) headers.set("content-type", "application/json")

  const response = await fetch(klingAIURL(baseURL, endpointPath), {
    method: options.method ?? (options.body ? "POST" : "GET"),
    headers,
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    signal: AbortSignal.timeout(KLINGAI_REQUEST_TIMEOUT_MS),
  })
  const responseText = await response.text()
  const parsed = parseKlingAIJSON(responseText)
  const remoteMessage = stringValue(parsed.message) ?? stringValue(parsed.msg) ?? stringValue(parsed.error) ?? responseText
  if (!response.ok) {
    throw new ApiError(
      response.status === 401 || response.status === 403 ? 401 : 502,
      klingAIAPIErrorCode(response.status),
      klingAIRequestErrorMessage(response.status, remoteMessage),
    )
  }

  const code = parsed.code
  const okCode = code === undefined || code === 0 || code === "0"
  if (!okCode) {
    throw new ApiError(
      502,
      "CINEMA_KLINGAI_API_ERROR",
      `KlingAI returned an error${remoteMessage ? `: ${redactKlingAIErrorText(remoteMessage)}` : "."}`,
    )
  }

  return {
    message: remoteMessage ? redactKlingAIErrorText(remoteMessage) : undefined,
    data: isRecord(parsed.data) ? parsed.data : parsed,
  }
}

function klingAITaskIDFromResponse(response: KlingAIParsedResponse) {
  return stringValue(response.data?.task_id) ?? stringValue(response.data?.taskID) ?? stringValue(response.data?.id)
}

function klingAITaskStatusFromResponse(response: KlingAIParsedResponse): CinemaGenerationTask["status"] {
  const status = stringValue(response.data?.task_status) ?? stringValue(response.data?.status)
  switch (status?.toLowerCase()) {
    case "submitted":
    case "created":
    case "pending":
    case "queued":
      return "queued"
    case "processing":
    case "running":
    case "in_progress":
      return "running"
    case "succeed":
    case "succeeded":
    case "success":
    case "completed":
      return "succeeded"
    case "failed":
    case "failure":
    case "error":
      return "failed"
    default:
      return "running"
  }
}

function klingAITaskMessage(response: KlingAIParsedResponse) {
  return (
    stringValue(response.data?.task_status_msg) ??
    stringValue(response.data?.status_msg) ??
    stringValue(response.data?.message) ??
    response.message
  )
}

function klingAIProgressFromResponse(
  response: KlingAIParsedResponse,
  status: CinemaGenerationTask["status"],
  message?: string,
): CinemaGenerationTask["progress"] {
  const updatedAt = new Date().toISOString()
  const base = {
    updatedAt,
    ...(message ? { message } : {}),
  }
  const remoteStatus = (
    stringValue(response.data?.task_status) ??
    stringValue(response.data?.status) ??
    ""
  ).toLowerCase()

  switch (status) {
    case "queued":
      return { ...base, phase: remoteStatus === "submitted" ? "submitted" : "queued" }
    case "running":
      return { ...base, phase: "processing" }
    case "succeeded":
      return { ...base, phase: "succeeded", percent: 100 }
    case "failed":
      return { ...base, phase: "failed" }
    case "canceled":
      return { ...base, phase: "canceled" }
  }
}

function normalizeKlingAICallbackResponse(payload: unknown): KlingAIParsedResponse {
  const record = isRecord(payload) ? payload : {}
  return {
    message: stringValue(record.message) ?? stringValue(record.msg) ?? stringValue(record.error),
    data: isRecord(record.data) ? record.data : record,
  }
}

function klingAIVideosFromResponse(response: KlingAIParsedResponse): KlingAIVideoResult[] {
  const taskResult = isRecord(response.data?.task_result) ? response.data.task_result : response.data?.result
  const resultRecord = isRecord(taskResult) ? taskResult : {}
  const videos = Array.isArray(resultRecord.videos)
    ? resultRecord.videos
    : Array.isArray(response.data?.videos)
      ? response.data.videos
      : []
  return videos.flatMap((item, index) => {
    if (typeof item === "string" && item.trim()) return [{ id: `kling-video-${index + 1}`, url: item.trim() }]
    if (!isRecord(item)) return []
    const url = stringValue(item.url) ?? stringValue(item.video_url) ?? stringValue(item.download_url)
    if (!url) return []
    return [{
      id: stringValue(item.id),
      url,
    }]
  })
}

function klingAIImagesFromResponse(response: KlingAIParsedResponse): KlingAIImageResult[] {
  const taskResult = isRecord(response.data?.task_result) ? response.data.task_result : response.data?.result
  const resultRecord = isRecord(taskResult) ? taskResult : {}
  const images = Array.isArray(resultRecord.images)
    ? resultRecord.images
    : Array.isArray(response.data?.images)
      ? response.data.images
      : []
  return images.flatMap((item, index) => {
    if (typeof item === "string" && item.trim()) return [{ id: `kling-image-${index + 1}`, url: item.trim() }]
    if (!isRecord(item)) return []
    const url = stringValue(item.url)
      ?? stringValue(item.image_url)
      ?? stringValue(item.imageUrl)
      ?? stringValue(item.download_url)
    if (!url) return []
    return [{
      id: stringValue(item.id),
      url,
    }]
  })
}

function safeKlingAISegment(value: string) {
  const readable = value.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^_+|_+$/g, "").slice(0, 80)
  return readable || "kling-video"
}

function projectRelativePath(root: string, filePath: string) {
  return path.relative(root, filePath).split(path.sep).join("/")
}

function resolveProjectRelativeFile(root: string, relativePath: string) {
  const normalizedInput = relativePath.replace(/\\/g, "/").replace(/^\/+/, "")
  if (!normalizedInput || normalizedInput.includes("\0") || path.isAbsolute(relativePath) || normalizedInput.split("/").includes("..")) {
    throw new ApiError(400, "CINEMA_ASSET_PATH_INVALID", "Asset path must be a project-relative path.")
  }

  const resolvedRoot = path.resolve(root)
  const resolvedPath = path.resolve(root, normalizedInput)
  const relative = path.relative(resolvedRoot, resolvedPath)
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ApiError(400, "CINEMA_ASSET_PATH_INVALID", "Asset path must stay inside the current project.")
  }

  return resolvedPath
}

function imageMimeAndExtensionFromResponse(response: Response, sourceURL: string) {
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase()
  if (contentType && IMAGE_EXTENSION_BY_MIME[contentType] && isSupportedImageMime(contentType)) {
    return {
      mimeType: contentType,
      extension: IMAGE_EXTENSION_BY_MIME[contentType],
    }
  }

  const extension = path.extname(new URL(sourceURL).pathname).toLowerCase()
  const mimeType = IMAGE_MIME_BY_EXTENSION[extension]
  if (mimeType && isSupportedImageMime(mimeType)) {
    return {
      mimeType,
      extension,
    }
  }

  return {
    mimeType: "image/png",
    extension: ".png",
  }
}

function videoMimeAndExtensionFromResponse(response: Response, sourceURL: string) {
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase()
  if (contentType && VIDEO_EXTENSION_BY_MIME[contentType]) {
    return {
      mimeType: contentType,
      extension: VIDEO_EXTENSION_BY_MIME[contentType],
    }
  }

  const extension = path.extname(new URL(sourceURL).pathname).toLowerCase()
  const mimeType = VIDEO_MIME_BY_EXTENSION[extension]
  if (mimeType) {
    return {
      mimeType,
      extension,
    }
  }

  return {
    mimeType: "video/mp4",
    extension: ".mp4",
  }
}

async function downloadKlingAIImageAssets(input: {
  root: string
  task: CinemaGenerationTask
  images: KlingAIImageResult[]
}): Promise<CinemaGeneratedAsset[]> {
  const taskSegment = safeKlingAISegment(input.task.taskNodeID ?? input.task.id)
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const outputDirectory = path.join(input.root, "generated", "images", taskSegment)
  await mkdir(outputDirectory, { recursive: true })

  const assets: CinemaGeneratedAsset[] = []
  for (const [index, image] of input.images.entries()) {
    let sourceURL: URL
    try {
      sourceURL = new URL(image.url)
    } catch {
      throw new ApiError(502, "CINEMA_KLINGAI_OUTPUT_URL_INVALID", "KlingAI returned an invalid image output URL.")
    }
    if (sourceURL.protocol !== "http:" && sourceURL.protocol !== "https:") {
      throw new ApiError(502, "CINEMA_KLINGAI_OUTPUT_URL_INVALID", "KlingAI image output URL must use http or https.")
    }

    const response = await fetch(sourceURL, {
      signal: AbortSignal.timeout(KLINGAI_DOWNLOAD_TIMEOUT_MS),
    })
    if (!response.ok) {
      throw new ApiError(502, "CINEMA_KLINGAI_OUTPUT_DOWNLOAD_FAILED", `Failed to download KlingAI image output (HTTP ${response.status}).`)
    }
    const expectedSize = Number(response.headers.get("content-length"))
    if (Number.isFinite(expectedSize) && expectedSize > KLINGAI_IMAGE_ASSET_MAX_BYTES) {
      throw new ApiError(413, "CINEMA_KLINGAI_OUTPUT_TOO_LARGE", "KlingAI image output is too large to save locally.")
    }

    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength === 0) {
      throw new ApiError(502, "CINEMA_KLINGAI_OUTPUT_EMPTY", "KlingAI returned an empty image output.")
    }
    if (bytes.byteLength > KLINGAI_IMAGE_ASSET_MAX_BYTES) {
      throw new ApiError(413, "CINEMA_KLINGAI_OUTPUT_TOO_LARGE", "KlingAI image output is too large to save locally.")
    }

    const { mimeType, extension } = imageMimeAndExtensionFromResponse(response, sourceURL.toString())
    const filePath = path.join(outputDirectory, `${timestamp}-${index + 1}${extension}`)
    await writeFile(filePath, bytes)
    const dimensions = readImageDimensions(bytes, mimeType)
    assets.push({
      id: image.id ?? `image-${timestamp}-${index + 1}`,
      kind: "image",
      path: projectRelativePath(input.root, filePath),
      mimeType,
      sizeBytes: bytes.byteLength,
      url: sourceURL.toString(),
      ...dimensions,
    })
  }

  return assets
}

async function downloadKlingAIVideoAssets(input: {
  root: string
  task: CinemaGenerationTask
  videos: KlingAIVideoResult[]
}): Promise<CinemaGeneratedAsset[]> {
  const taskSegment = safeKlingAISegment(input.task.taskNodeID ?? input.task.id)
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const outputDirectory = path.join(input.root, "generated", "videos", taskSegment)
  await mkdir(outputDirectory, { recursive: true })

  const assets: CinemaGeneratedAsset[] = []
  for (const [index, video] of input.videos.entries()) {
    let sourceURL: URL
    try {
      sourceURL = new URL(video.url)
    } catch {
      throw new ApiError(502, "CINEMA_KLINGAI_OUTPUT_URL_INVALID", "KlingAI returned an invalid video output URL.")
    }
    if (sourceURL.protocol !== "http:" && sourceURL.protocol !== "https:") {
      throw new ApiError(502, "CINEMA_KLINGAI_OUTPUT_URL_INVALID", "KlingAI video output URL must use http or https.")
    }

    const response = await fetch(sourceURL, {
      signal: AbortSignal.timeout(KLINGAI_DOWNLOAD_TIMEOUT_MS),
    })
    if (!response.ok) {
      throw new ApiError(502, "CINEMA_KLINGAI_OUTPUT_DOWNLOAD_FAILED", `Failed to download KlingAI video output (HTTP ${response.status}).`)
    }
    const expectedSize = Number(response.headers.get("content-length"))
    if (Number.isFinite(expectedSize) && expectedSize > KLINGAI_VIDEO_ASSET_MAX_BYTES) {
      throw new ApiError(413, "CINEMA_KLINGAI_OUTPUT_TOO_LARGE", "KlingAI video output is too large to save locally.")
    }

    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength === 0) {
      throw new ApiError(502, "CINEMA_KLINGAI_OUTPUT_EMPTY", "KlingAI returned an empty video output.")
    }
    if (bytes.byteLength > KLINGAI_VIDEO_ASSET_MAX_BYTES) {
      throw new ApiError(413, "CINEMA_KLINGAI_OUTPUT_TOO_LARGE", "KlingAI video output is too large to save locally.")
    }

    const { mimeType, extension } = videoMimeAndExtensionFromResponse(response, sourceURL.toString())
    const filePath = path.join(outputDirectory, `${timestamp}-${index + 1}${extension}`)
    await writeFile(filePath, bytes)
    assets.push({
      id: video.id ?? `video-${timestamp}-${index + 1}`,
      kind: "video",
      path: projectRelativePath(input.root, filePath),
      mimeType,
      sizeBytes: bytes.byteLength,
      url: sourceURL.toString(),
    })
  }

  return assets
}

function klingAIEndpointKindForTask(task: CinemaGenerationTask): KlingAIEndpointKind {
  const refKind = stringValue(task.providerTaskRef?.kind)
  if (refKind === "text2video" || refKind === "image2video" || refKind === "image-generation") return refKind
  if (task.mode === "text-to-image") return "image-generation"
  return task.mode === "image-to-video" ? "image2video" : "text2video"
}

function klingAITaskRefFor(task: CinemaGenerationTask, taskID: string, kind: KlingAIEndpointKind) {
  const existingRef = isRecord(task.providerTaskRef) ? task.providerTaskRef : {}
  return {
    ...existingRef,
    providerID: KLINGAI_PROVIDER_ID,
    taskID,
    kind,
    endpoint: klingAIEndpointPath(kind),
  }
}

function klingAICallbackURLForTask(task: CinemaGenerationTask) {
  const callback = isRecord(task.providerTaskRef?.callback) ? task.providerTaskRef.callback : undefined
  return stringValue(callback?.url)
}

async function applyKlingAITaskResponse(input: {
  root: string
  task: CinemaGenerationTask
  response: KlingAIParsedResponse
}): Promise<CinemaGenerationTask> {
  const status = klingAITaskStatusFromResponse(input.response)
  const message = klingAITaskMessage(input.response)
  const progress = klingAIProgressFromResponse(input.response, status, message)
  if (status === "failed") {
    return taskUpdated(input.task, {
      status,
      error: message ?? "KlingAI video generation failed.",
      progress,
    })
  }

  if (status !== "succeeded") {
    return taskUpdated(input.task, {
      status,
      error: null,
      progress,
    })
  }

  if (input.task.outputAssets.length > 0) {
    return taskUpdated(input.task, {
      status,
      error: null,
      progress,
    })
  }

  if (input.task.mode === "text-to-image") {
    const images = klingAIImagesFromResponse(input.response)
    if (images.length === 0) {
      return taskUpdated(input.task, {
        status: "failed",
        error: "KlingAI marked the task succeeded but did not return an image output URL.",
        progress: klingAIProgressFromResponse(input.response, "failed", "KlingAI marked the task succeeded but did not return an image output URL."),
      })
    }

    try {
      const outputAssets = await downloadKlingAIImageAssets({
        root: input.root,
        task: input.task,
        images,
      })
      return taskUpdated(input.task, {
        status: "succeeded",
        outputAssets,
        error: null,
        progress,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return taskUpdated(input.task, {
        status: "failed",
        error: redactKlingAIErrorText(message || "Failed to download KlingAI image output."),
        progress: klingAIProgressFromResponse(input.response, "failed", redactKlingAIErrorText(message || "Failed to download KlingAI image output.")),
      })
    }
  }

  const videos = klingAIVideosFromResponse(input.response)
  if (videos.length === 0) {
    return taskUpdated(input.task, {
      status: "failed",
      error: "KlingAI marked the task succeeded but did not return a video output URL.",
      progress: klingAIProgressFromResponse(input.response, "failed", "KlingAI marked the task succeeded but did not return a video output URL."),
    })
  }

  try {
    const outputAssets = await downloadKlingAIVideoAssets({
      root: input.root,
      task: input.task,
      videos,
    })
    return taskUpdated(input.task, {
      status: "succeeded",
      outputAssets,
      error: null,
      progress,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return taskUpdated(input.task, {
      status: "failed",
      error: redactKlingAIErrorText(message || "Failed to download KlingAI video output."),
      progress: klingAIProgressFromResponse(input.response, "failed", redactKlingAIErrorText(message || "Failed to download KlingAI video output.")),
    })
  }
}

function parameterString(parameters: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = numberOrStringValue(parameters[key])
    if (value) return value
  }
  return undefined
}

function promptWithStyle(prompt: string, parameters: Record<string, unknown>) {
  const style = parameterString(parameters, "style")
  return style ? `${prompt.trim()}\n\nStyle: ${style}` : prompt
}

function aspectRatioFromSize(value: string | undefined) {
  const match = /^(\d+)x(\d+)$/.exec(value ?? "")
  if (!match) return undefined
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined

  let left = width
  let right = height
  while (right !== 0) {
    const remainder = left % right
    left = right
    right = remainder
  }
  return `${width / left}:${height / left}`
}

function klingAIQualityMode(parameters: Record<string, unknown>) {
  const explicit = parameterString(parameters, "klingMode", "qualityMode", "mode")
  if (explicit && /^(std|pro|4k)$/i.test(explicit)) return explicit.toLowerCase()

  const resolution = parameterString(parameters, "resolution")
  if (/4\s*k/i.test(resolution ?? "")) return "4k"
  if (/1080|pro/i.test(resolution ?? "")) return "pro"
  return "std"
}

function appendOptionalPayloadString(
  target: Record<string, unknown>,
  outputKey: string,
  parameters: Record<string, unknown>,
  ...inputKeys: string[]
) {
  const value = parameterString(parameters, ...inputKeys)
  if (value) target[outputKey] = value
}

function klingAIExternalTaskID(taskID: string) {
  return safeKlingAISegment(taskID).slice(0, 64)
}

async function klingAIImageInput(root: string, parameters: Record<string, unknown>) {
  const sourceImageURL = stringValue(parameters.sourceImageURL) ?? stringValue(parameters.imageURL)
  if (sourceImageURL) {
    let url: URL
    try {
      url = new URL(sourceImageURL)
    } catch {
      throw new ApiError(400, "CINEMA_KLINGAI_SOURCE_IMAGE_INVALID", "KlingAI source image URL must be a valid absolute URL.")
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new ApiError(400, "CINEMA_KLINGAI_SOURCE_IMAGE_INVALID", "KlingAI source image URL must use http or https.")
    }
    return url.toString()
  }

  const sourceImagePath = stringValue(parameters.sourceImagePath) ?? stringValue(parameters.imagePath)
  if (!sourceImagePath) {
    throw new ApiError(
      400,
      "CINEMA_KLINGAI_SOURCE_IMAGE_REQUIRED",
      "Image-to-video requires a source image. Connect an image node with a generated asset before submitting.",
    )
  }

  const filePath = resolveProjectRelativeFile(root, sourceImagePath)
  const fileStat = await stat(filePath).catch((error: unknown) => {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new ApiError(404, "CINEMA_KLINGAI_SOURCE_IMAGE_NOT_FOUND", "KlingAI source image asset was not found.")
    }
    throw error
  })
  if (!fileStat.isFile()) {
    throw new ApiError(400, "CINEMA_KLINGAI_SOURCE_IMAGE_INVALID", "KlingAI source image path must point to a file.")
  }
  if (fileStat.size > 25 * 1024 * 1024) {
    throw new ApiError(413, "CINEMA_KLINGAI_SOURCE_IMAGE_TOO_LARGE", "KlingAI source image is too large.")
  }

  return Buffer.from(await readFile(filePath)).toString("base64")
}

async function klingAITaskPayload(input: ProviderAdapterCreateInput, kind: KlingAIEndpointKind) {
  const parameters = input.task.input.parameters
  const payload: Record<string, unknown> = {
    model_name: input.task.modelID,
    prompt: kind === "image-generation" ? promptWithStyle(input.task.input.prompt, parameters) : input.task.input.prompt,
    external_task_id: klingAIExternalTaskID(input.task.id),
  }
  const callbackURL = klingAICallbackURLForTask(input.task)
  if (callbackURL) payload.callback_url = callbackURL

  appendOptionalPayloadString(payload, "aspect_ratio", parameters, "aspectRatio", "aspect_ratio")
  if (kind === "image-generation" && !payload.aspect_ratio) {
    const aspectRatio = aspectRatioFromSize(parameterString(parameters, "size"))
    if (aspectRatio) payload.aspect_ratio = aspectRatio
  }
  appendOptionalPayloadString(payload, "duration", parameters, "duration")
  appendOptionalPayloadString(payload, "negative_prompt", parameters, "negativePrompt", "negative_prompt")
  appendOptionalPayloadString(payload, "cfg_scale", parameters, "cfgScale", "cfg_scale")
  appendOptionalPayloadString(payload, "resolution", parameters, "resolution")
  const count = Number(parameters.count)
  if (Number.isInteger(count) && count > 0) payload.n = count
  if (kind !== "image-generation") payload.mode = klingAIQualityMode(parameters)

  if (kind === "image2video") {
    payload.image = await klingAIImageInput(input.root, parameters)
  }

  return payload
}

const KlingAIProviderAdapter: ProviderAdapter = {
  manifest: {} as CinemaVideoProviderManifest,
  supportedModes: ["text-to-video", "image-to-video", "text-to-image"],
  createTask: async (input) => {
    const kind = input.task.mode === "text-to-image"
      ? "image-generation"
      : input.task.mode === "image-to-video"
        ? "image2video"
        : "text2video"
    const payload = await klingAITaskPayload(input, kind)
    const response = await requestKlingAI(klingAIEndpointPath(kind), {
      method: "POST",
      body: payload,
    })
    const providerTaskID = klingAITaskIDFromResponse(response)
    if (!providerTaskID) {
      throw new ApiError(502, "CINEMA_KLINGAI_TASK_ID_MISSING", "KlingAI did not return a task ID.")
    }

    const task = taskUpdated(input.task, {
      providerTaskRef: klingAITaskRefFor(input.task, providerTaskID, kind),
    })
    return await applyKlingAITaskResponse({
      root: input.root,
      task,
      response,
    })
  },
  refreshTask: async (input) => {
    const providerTaskID = stringValue(input.task.providerTaskRef?.taskID) ?? stringValue(input.task.providerTaskRef?.task_id)
    if (!providerTaskID) {
      return taskUpdated(input.task, {
        status: "failed",
        error: "KlingAI task is missing its provider task ID.",
        progress: {
          phase: "failed",
          message: "KlingAI task is missing its provider task ID.",
          updatedAt: new Date().toISOString(),
        },
      })
    }

    const kind = klingAIEndpointKindForTask(input.task)
    const response = await requestKlingAI(klingAIEndpointPath(kind, providerTaskID))
    return await applyKlingAITaskResponse({
      root: input.root,
      task: input.task,
      response,
    })
  },
  receiveCallback: async (input) => {
    const response = normalizeKlingAICallbackResponse(input.payload)
    const callbackTaskID = klingAITaskIDFromResponse(response)
    const providerTaskID = stringValue(input.task.providerTaskRef?.taskID) ?? stringValue(input.task.providerTaskRef?.task_id)
    if (callbackTaskID && providerTaskID && callbackTaskID !== providerTaskID) {
      throw new ApiError(400, "CINEMA_KLINGAI_CALLBACK_TASK_MISMATCH", "KlingAI callback task ID does not match the saved provider task ID.")
    }

    return await applyKlingAITaskResponse({
      root: input.root,
      task: input.task,
      response,
    })
  },
}

registerCinemaVideoProviderAdapter(KLINGAI_PROVIDER_ID, KlingAIProviderAdapter)

export function assertCinemaVideoProviderModelSupports(
  input: CreateCinemaGenerationTaskBody,
  manifest: CinemaVideoProviderManifest,
) {
  const model = findCinemaVideoProviderModelForMode(manifest, input.modelID, input.mode)
  if (!model) {
    throw new ApiError(400, "CINEMA_PROVIDER_MODEL_NOT_FOUND", `Cinema provider '${manifest.id}' does not expose model '${input.modelID}'.`)
  }
  if (!model.modes.includes(input.mode)) {
    throw new ApiError(400, "CINEMA_PROVIDER_MODE_UNSUPPORTED", `Model '${input.modelID}' does not support mode '${input.mode}'.`)
  }
  if (providerAdapters[manifest.id] && !cinemaVideoProviderAdapterSupportsMode(manifest.id, input.mode)) {
    throw new ApiError(400, "CINEMA_PROVIDER_MODE_UNSUPPORTED", `Cinema provider '${manifest.id}' runtime does not support mode '${input.mode}'.`)
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
  const adapterAvailable = hasCinemaVideoProviderAdapter(manifest.id)
  const adapterRuntime = adapterAvailable
    ? {
        adapterAvailable,
        adapterID: manifest.id,
      }
    : { adapterAvailable }
  const configuredBaseURL = normalizeBaseURL(settings.baseURL)
  if (configuredBaseURL) {
    return {
      ...adapterRuntime,
      baseURL: configuredBaseURL,
      configuredBaseURL,
      baseURLSource: "settings",
    }
  }

  const defaultBaseURL = defaultBaseURLForProvider(manifest)
  if (!defaultBaseURL) return adapterRuntime
  return {
    ...adapterRuntime,
    baseURL: defaultBaseURL,
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
