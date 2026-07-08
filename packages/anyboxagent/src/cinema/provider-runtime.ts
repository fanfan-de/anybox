import { createHmac } from "node:crypto"
import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { z } from "zod"
import {
  type CinemaCanvasDocument,
  type CinemaGeneratedAsset,
  type CinemaGenerationTask,
  type CinemaProviderAuthState,
  type CinemaProviderInputCombination,
  type CinemaProviderInputSpec,
  type CinemaProviderModelMode,
  type GenerationControl,
  type GenerationFormSpec,
  type TestCinemaVideoProviderConnectionBody,
  type CinemaVideoProvider,
  type CinemaVideoProviderManifest,
  type CinemaProviderEndpoint,
  CinemaProviderEndpointMethodSchema,
  CinemaProviderEndpointSchema,
  CinemaProviderTaskQueryEndpointSchema,
  CinemaProviderModelModeSchema,
  CinemaVideoProviderManifestSchema,
  ProviderInputUIControlSchema,
  type CreateCinemaGenerationTaskBody,
} from "@anybox/shared/cinema"
import * as ProviderAuth from "#auth/provider-auth.ts"
import * as Config from "#config/config.ts"
import { ApiError } from "#server/error.ts"
import {
  isSupportedImageMime,
  readImageDimensions,
} from "#session/support/image-assets.ts"
import * as Log from "#util/log.ts"

const REQUEST_TIMEOUT_MS = 10 * 1000
const LOCAL_PROVIDER_MANIFEST_CATALOG_SOURCE = "local-provider-manifest"
const KLINGAI_PROVIDER_ID = "klingai"
const KLINGAI_CN_PROVIDER_ID = "klingai-cn"
const KLINGAI_GLOBAL_PROVIDER_ID = "klingai-global"
const KLINGAI_PROVIDER_IDS = [KLINGAI_PROVIDER_ID, KLINGAI_CN_PROVIDER_ID, KLINGAI_GLOBAL_PROVIDER_ID] as const
const KLINGAI_CN_DEFAULT_BASE_URL = "https://api-beijing.klingai.com"
const KLINGAI_GLOBAL_DEFAULT_BASE_URL = "https://api-singapore.klingai.com"
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
  supportsInputCombination?: (
    input: {
      model: CinemaVideoProviderManifest["models"][number]
      combination: CinemaProviderInputCombination
    }
  ) => boolean
  createTask: (input: ProviderAdapterCreateInput) => Promise<CinemaGenerationTask>
  refreshTask: (input: ProviderAdapterRefreshInput) => Promise<CinemaGenerationTask>
  receiveCallback?: (input: ProviderAdapterCallbackInput) => Promise<CinemaGenerationTask>
  cancelTask?: (input: ProviderAdapterRefreshInput) => Promise<CinemaGenerationTask>
}

const RawCatalogInputSpecSchema = z
  .object({
    role: z.string().min(1),
    modality: z.string().min(1),
    required: z.boolean().default(false),
    min_count: z.number().int().nonnegative().default(0),
    max_count: z.number().int().nonnegative().optional(),
    note: z.string().min(1).optional(),
  })
  .passthrough()

const RawCatalogInputRequirementSchema = z
  .object({
    roles: z.array(z.string().min(1)).default([]),
    min_total_count: z.number().int().nonnegative().optional(),
    note: z.string().min(1).optional(),
  })
  .passthrough()

const RawCatalogEndpointSchema = z
  .object({
    method: z.preprocess(
      (value) => typeof value === "string" ? value.trim().toUpperCase() : value,
      CinemaProviderEndpointMethodSchema,
    ).optional(),
    path: z.string().min(1).optional(),
    url: z.string().min(1).optional(),
  })
  .passthrough()

const RawCatalogInputCombinationSchema = z
  .object({
    mode: z.string().min(1),
    label: z.string().min(1).optional(),
    required_modalities: z.array(z.string().min(1)).default([]),
    optional_modalities: z.array(z.string().min(1)).default([]),
    inputs: z.array(RawCatalogInputSpecSchema).default([]),
    requirements: z.array(RawCatalogInputRequirementSchema).default([]),
    endpoint: RawCatalogEndpointSchema.optional(),
    note: z.string().min(1).optional(),
  })
  .passthrough()

const RawCatalogModelSchema = z
  .object({
    id: z.string().min(1),
    offering_id: z.string().min(1).optional(),
    provider_model_id: z.string().min(1).optional(),
    catalog_id: z.string().min(1).optional(),
    name: z.string().min(1),
    family: z.string().min(1).optional(),
    lab: z.string().min(1).optional(),
    base_model: z.string().min(1).optional(),
    endpoint_type: z.string().min(1).optional(),
    task_query_endpoint: RawCatalogEndpointSchema.optional(),
    modalities: z
      .object({
        input: z.array(z.string().min(1)).default([]),
        output: z.array(z.string().min(1)).default([]),
      })
      .optional(),
    input_modalities: z.array(z.string().min(1)).optional(),
    output_modalities: z.array(z.string().min(1)).optional(),
    modes: z.array(z.string().min(1)).default([]),
    input_combinations: z.array(RawCatalogInputCombinationSchema).default([]),
    audio_output: z.boolean().optional(),
    supports_audio_output: z.boolean().optional(),
    supports_first_last_frame: z.boolean().optional(),
    max_reference_images: z.number().int().nonnegative().optional(),
    requires_public_input_url: z.boolean().optional(),
    pricing: z.array(z.record(z.string(), z.unknown())).default([]),
    limit: z
      .object({
        durations: z.array(z.number()).default([]),
        resolutions: z.array(z.string().min(1)).default([]),
        resolution_labels: z.record(z.string(), z.string()).default({}),
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
type RawCatalog = z.output<typeof RawCatalogSchema>
type RawCatalogInput = z.input<typeof RawCatalogSchema>

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

const LocalProviderManifestInlineCatalogSchema = z.union([
  z.array(CinemaVideoProviderManifestSchema),
  z.object({
    schemaVersion: z.literal(1),
    providers: z.array(CinemaVideoProviderManifestSchema),
  }),
])

const LocalProviderManifestIncludeCatalogSchema = z.object({
  schemaVersion: z.literal(1),
  includes: z.array(z.string().min(1)),
})

const LocalProviderModelIncludeListSchema = z.object({
  includes: z.array(z.string().min(1)),
})

type CinemaVideoProviderModelManifest = CinemaVideoProviderManifest["models"][number]

type ProviderManifestCatalogSnapshot = {
  data: CinemaVideoProviderManifest[]
  signature?: string
  filepaths: string[]
}

let catalogOverride: CinemaVideoProviderManifest[] | undefined
let cachedCatalogManifests: CinemaVideoProviderManifest[] | undefined
let loadedManifestSignature: string | undefined
let loadedManifestFilepaths: string[] = []
let manifestFilePathOverride: string | undefined

function defaultProviderManifestFilePath() {
  return fileURLToPath(new URL("./provider-manifests.json", import.meta.url))
}

function providerManifestFilePath() {
  return manifestFilePathOverride ?? defaultProviderManifestFilePath()
}

function sortedProviderManifests(manifests: CinemaVideoProviderManifest[]) {
  return [...manifests].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
}

function validateProviderManifestIDs(manifests: CinemaVideoProviderManifest[], source: string) {
  const ids = new Set<string>()
  for (const manifest of manifests) {
    if (ids.has(manifest.id)) {
      throw new Error(`Duplicate Cinema provider manifest id '${manifest.id}' in ${source}.`)
    }
    ids.add(manifest.id)
  }
}

function validateProviderModelIDs(manifest: CinemaVideoProviderManifest, source: string) {
  const ids = new Set<string>()
  for (const model of manifest.models) {
    if (ids.has(model.id)) {
      throw new Error(`Duplicate Cinema provider model id '${model.id}' for provider '${manifest.id}' in ${source}.`)
    }
    ids.add(model.id)
  }
}

function providerManifestsFromLocalCatalog(value: unknown, source: string) {
  const parsed = LocalProviderManifestInlineCatalogSchema.parse(value)
  const manifests = Array.isArray(parsed) ? parsed : parsed.providers
  validateProviderManifestIDs(manifests, source)
  return sortedProviderManifests(manifests)
}

function providerManifestsFromCatalogInput(catalog: unknown, source: string) {
  const localCatalog = LocalProviderManifestInlineCatalogSchema.safeParse(catalog)
  if (localCatalog.success) {
    const manifests = Array.isArray(localCatalog.data) ? localCatalog.data : localCatalog.data.providers
    validateProviderManifestIDs(manifests, source)
    return sortedProviderManifests(manifests)
  }

  const rawCatalog = RawCatalogSchema.parse(catalog)
  const manifests = Object.values(rawCatalog).map(manifestFromCatalogProvider)
  validateProviderManifestIDs(manifests, source)
  return sortedProviderManifests(manifests)
}

async function localManifestFilesSignature(filepaths: string[]) {
  const signatures = await Promise.all(
    [...new Set(filepaths)].sort().map(async (filepath) => {
      const signature = await stat(filepath)
        .then((fileStat) => `${fileStat.mtimeMs}:${fileStat.size}`)
        .catch(() => "missing")
      return `${filepath}:${signature}`
    })
  )
  return signatures.join("|")
}

function resolveProviderManifestIncludePath(source: string, includePath: string) {
  return path.resolve(path.dirname(source), includePath)
}

async function readLocalManifestJsonFile(filepath: string, readFilepaths: Set<string>) {
  const resolved = path.resolve(filepath)
  readFilepaths.add(resolved)
  const text = await readFile(resolved, "utf8")
  return JSON.parse(text) as unknown
}

function providerModelFromLocalCatalogInput(value: unknown, source: string): CinemaVideoProviderModelManifest {
  const parsed = CinemaVideoProviderManifestSchema.parse({
    id: "__model_validation__",
    name: "__model_validation__",
    models: [value],
  })
  const model = parsed.models[0]
  if (!model) {
    throw new Error(`Cinema provider model manifest in ${source} did not produce a model.`)
  }
  return model
}

async function providerManifestFromLocalCatalogInput(
  value: unknown,
  source: string,
  readFilepaths: Set<string>
): Promise<CinemaVideoProviderManifest> {
  const modelIncludeProvider = z
    .object({
      models: LocalProviderModelIncludeListSchema,
    })
    .passthrough()
    .safeParse(value)

  if (modelIncludeProvider.success) {
    const models: CinemaVideoProviderModelManifest[] = []
    for (const includePath of modelIncludeProvider.data.models.includes) {
      const modelPath = resolveProviderManifestIncludePath(source, includePath)
      const modelValue = await readLocalManifestJsonFile(modelPath, readFilepaths)
      models.push(providerModelFromLocalCatalogInput(modelValue, modelPath))
    }

    const manifest = CinemaVideoProviderManifestSchema.parse({
      ...modelIncludeProvider.data,
      models,
    })
    validateProviderModelIDs(manifest, source)
    return manifest
  }

  const manifest = CinemaVideoProviderManifestSchema.parse(value)
  validateProviderModelIDs(manifest, source)
  return manifest
}

async function providerManifestsFromLocalCatalogFile(value: unknown, source: string, readFilepaths: Set<string>) {
  const inlineCatalog = LocalProviderManifestInlineCatalogSchema.safeParse(value)
  if (inlineCatalog.success) {
    const manifests = Array.isArray(inlineCatalog.data) ? inlineCatalog.data : inlineCatalog.data.providers
    validateProviderManifestIDs(manifests, source)
    return sortedProviderManifests(manifests)
  }

  const includeCatalog = LocalProviderManifestIncludeCatalogSchema.safeParse(value)
  if (includeCatalog.success) {
    const manifests: CinemaVideoProviderManifest[] = []
    for (const includePath of includeCatalog.data.includes) {
      const manifestPath = resolveProviderManifestIncludePath(source, includePath)
      const manifestValue = await readLocalManifestJsonFile(manifestPath, readFilepaths)
      manifests.push(await providerManifestFromLocalCatalogInput(manifestValue, manifestPath, readFilepaths))
    }

    validateProviderManifestIDs(manifests, source)
    return sortedProviderManifests(manifests)
  }

  return providerManifestsFromLocalCatalog(value, source)
}

async function readLocalProviderManifestCatalog(): Promise<ProviderManifestCatalogSnapshot> {
  const filepath = path.resolve(providerManifestFilePath())
  const readFilepaths = new Set<string>()

  try {
    const catalog = await readLocalManifestJsonFile(filepath, readFilepaths)
    const data = await providerManifestsFromLocalCatalogFile(catalog, filepath, readFilepaths)
    const filepaths = [...readFilepaths]
    return {
      data,
      signature: await localManifestFilesSignature(filepaths),
      filepaths,
    }
  } catch (error) {
    log.error("Failed to parse local Cinema provider manifest catalog", { filepath, error })
    throw error
  }
}

async function invalidateIfProviderManifestFileChanged() {
  if (!loadedManifestSignature) return
  const filepaths = loadedManifestFilepaths.length > 0 ? loadedManifestFilepaths : [path.resolve(providerManifestFilePath())]
  const currentSignature = await localManifestFilesSignature(filepaths)
  if (currentSignature === loadedManifestSignature) return

  loadedManifestSignature = undefined
  cachedCatalogManifests = undefined
  loadedManifestFilepaths = []
}

async function loadProviderManifests(): Promise<CinemaVideoProviderManifest[]> {
  if (catalogOverride) return catalogOverride
  await invalidateIfProviderManifestFileChanged()
  if (cachedCatalogManifests) return cachedCatalogManifests

  const localCatalog = await readLocalProviderManifestCatalog()
  loadedManifestSignature = localCatalog.signature
  loadedManifestFilepaths = localCatalog.filepaths
  cachedCatalogManifests = localCatalog.data
  return localCatalog.data
}

export async function refreshCinemaVideoProviderCatalog(): Promise<CinemaVideoProvider[]> {
  cachedCatalogManifests = undefined
  loadedManifestSignature = undefined
  loadedManifestFilepaths = []
  return await listCinemaVideoProviders()
}

export function setCinemaVideoProviderCatalogForTest(catalog: unknown | undefined) {
  const previous = catalogOverride
  catalogOverride = catalog ? providerManifestsFromCatalogInput(catalog, "test override") : undefined
  cachedCatalogManifests = undefined
  loadedManifestSignature = undefined
  loadedManifestFilepaths = []
  return () => {
    catalogOverride = previous
    cachedCatalogManifests = undefined
    loadedManifestSignature = undefined
    loadedManifestFilepaths = []
  }
}

export function setCinemaVideoProviderCatalogCacheFileForTest(filepath: string | undefined) {
  const previous = manifestFilePathOverride
  manifestFilePathOverride = filepath
  cachedCatalogManifests = undefined
  loadedManifestSignature = undefined
  loadedManifestFilepaths = []
  return () => {
    manifestFilePathOverride = previous
    cachedCatalogManifests = undefined
    loadedManifestSignature = undefined
    loadedManifestFilepaths = []
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

function normalizeCatalogEndpoint(
  endpoint: z.output<typeof RawCatalogEndpointSchema> | undefined,
): CinemaProviderEndpoint | undefined {
  if (!endpoint) return undefined
  const normalized: Record<string, unknown> = { ...endpoint }
  if (!normalized.taskQuery && isRecord(normalized.task_query)) {
    normalized.taskQuery = normalized.task_query
  }
  delete normalized.task_query
  if (typeof normalized.path === "string") {
    const pathValue = normalized.path.trim()
    if (pathValue) {
      normalized.path = pathValue
    } else {
      delete normalized.path
    }
  }
  if (typeof normalized.url === "string") {
    const urlValue = normalized.url.trim()
    if (urlValue) {
      normalized.url = urlValue
    } else {
      delete normalized.url
    }
  }
  if (isRecord(normalized.taskQuery)) {
    const taskQuery = { ...normalized.taskQuery }
    if (typeof taskQuery.path === "string") {
      const pathValue = taskQuery.path.trim()
      if (pathValue) {
        taskQuery.path = pathValue
      } else {
        delete taskQuery.path
      }
    }
    if (typeof taskQuery.url === "string") {
      const urlValue = taskQuery.url.trim()
      if (urlValue) {
        taskQuery.url = urlValue
      } else {
        delete taskQuery.url
      }
    }
    const parsedTaskQuery = CinemaProviderTaskQueryEndpointSchema.safeParse(taskQuery)
    if (parsedTaskQuery.success) {
      normalized.taskQuery = parsedTaskQuery.data
    } else {
      delete normalized.taskQuery
      log.warn("Ignoring invalid Cinema provider catalog task query endpoint", { endpoint, error: parsedTaskQuery.error })
    }
  }
  const parsed = CinemaProviderEndpointSchema.safeParse(normalized)
  if (parsed.success) return parsed.data
  log.warn("Ignoring invalid Cinema provider catalog endpoint", { endpoint, error: parsed.error })
  return undefined
}

function normalizeCatalogTaskQueryEndpoint(endpoint: z.output<typeof RawCatalogEndpointSchema> | undefined) {
  const normalized = normalizeCatalogEndpoint(endpoint)
  if (!normalized) return undefined
  if (normalized.taskQuery) return normalized.taskQuery
  return CinemaProviderTaskQueryEndpointSchema.parse({
    method: normalized.method,
    path: normalized.path,
    url: normalized.url,
  })
}

function isKlingAIProviderID(providerID: string) {
  return KLINGAI_PROVIDER_IDS.includes(providerID as typeof KLINGAI_PROVIDER_IDS[number])
}

function defaultKlingAIBaseURLForProvider(providerID: string) {
  return providerID === KLINGAI_CN_PROVIDER_ID
    ? KLINGAI_CN_DEFAULT_BASE_URL
    : KLINGAI_GLOBAL_DEFAULT_BASE_URL
}

function normalizeModes(values: string[]) {
  const modes = values.flatMap((value) => {
    const parsed = CinemaProviderModelModeSchema.safeParse(value.trim())
    return parsed.success ? [parsed.data] : []
  })
  return [...new Set(modes)]
}

function optionalStringField(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return undefined
}

function optionalNumberField(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === "number" && Number.isFinite(value)) return value
  }
  return undefined
}

function optionalStringArrayField(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (!Array.isArray(value)) continue
    const items = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    if (items.length > 0) return items
  }
  return undefined
}

function optionalStringRecordField(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (!isRecord(value)) continue
    const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")
    if (entries.length > 0) return Object.fromEntries(entries)
  }
  return undefined
}

function optionalUnknownRecordField(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (isRecord(value)) return value
  }
  return undefined
}

function optionalOptionsField(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (!Array.isArray(value)) continue
    const options = value.filter((item): item is string | number | boolean =>
      typeof item === "string" || typeof item === "number" || typeof item === "boolean"
    )
    if (options.length > 0) return options
  }
  return undefined
}

function optionalUIControlField(record: Record<string, unknown>, ...keys: string[]) {
  const value = optionalStringField(record, ...keys)
  const parsed = ProviderInputUIControlSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

function normalizeCatalogInputSpec(input: z.output<typeof RawCatalogInputSpecSchema>): CinemaProviderInputSpec {
  const record = input as Record<string, unknown>
  return {
    role: input.role,
    modality: input.modality,
    required: input.required,
    minCount: input.min_count,
    ...(input.max_count !== undefined ? { maxCount: input.max_count } : {}),
    ...(optionalStringField(record, "apiField", "api_field") ? { apiField: optionalStringField(record, "apiField", "api_field") } : {}),
    ...(optionalStringField(record, "providerField", "provider_field") ? { providerField: optionalStringField(record, "providerField", "provider_field") } : {}),
    ...(optionalStringField(record, "label") ? { label: optionalStringField(record, "label") } : {}),
    ...(optionalNumberField(record, "maxLength", "max_length") !== undefined ? { maxLength: optionalNumberField(record, "maxLength", "max_length") } : {}),
    ...("default" in record ? { default: record.default } : {}),
    ...(optionalOptionsField(record, "options") ? { options: optionalOptionsField(record, "options") } : {}),
    ...(optionalStringRecordField(record, "labels") ? { labels: optionalStringRecordField(record, "labels") } : {}),
    ...(optionalNumberField(record, "min") !== undefined ? { min: optionalNumberField(record, "min") } : {}),
    ...(optionalNumberField(record, "max") !== undefined ? { max: optionalNumberField(record, "max") } : {}),
    ...(optionalStringArrayField(record, "supportedFormats", "supported_formats") ? { supportedFormats: optionalStringArrayField(record, "supportedFormats", "supported_formats") } : {}),
    ...(optionalNumberField(record, "maxFileSizeMB", "max_file_size_mb") !== undefined ? { maxFileSizeMB: optionalNumberField(record, "maxFileSizeMB", "max_file_size_mb") } : {}),
    ...(optionalUIControlField(record, "uiControl", "ui_control") ? { uiControl: optionalUIControlField(record, "uiControl", "ui_control") } : {}),
    ...(optionalStringField(record, "uiGroup", "ui_group") ? { uiGroup: optionalStringField(record, "uiGroup", "ui_group") } : {}),
    ...(optionalNumberField(record, "uiOrder", "ui_order") !== undefined ? { uiOrder: optionalNumberField(record, "uiOrder", "ui_order") } : {}),
    ...(optionalUnknownRecordField(record, "visibleWhen", "visible_when") ? { visibleWhen: optionalUnknownRecordField(record, "visibleWhen", "visible_when") } : {}),
    ...(optionalUnknownRecordField(record, "disabledWhen", "disabled_when") ? { disabledWhen: optionalUnknownRecordField(record, "disabledWhen", "disabled_when") } : {}),
    ...(input.note ? { note: input.note } : {}),
  }
}

function inputCombinationsFromCatalogModel(model: RawCatalogModelSchemaOutput) {
  return (model.input_combinations ?? []).map((combination) => {
    const endpoint = normalizeCatalogEndpoint(combination.endpoint)
    return {
      mode: combination.mode,
      ...(combination.label ? { label: combination.label } : {}),
      requiredModalities: normalizeStringList(combination.required_modalities),
      optionalModalities: normalizeStringList(combination.optional_modalities),
      inputs: combination.inputs.map((input) => normalizeCatalogInputSpec(input)),
      requirements: combination.requirements.map((requirement) => ({
        roles: normalizeStringList(requirement.roles),
        ...(requirement.min_total_count !== undefined ? { minTotalCount: requirement.min_total_count } : {}),
        ...(requirement.note ? { note: requirement.note } : {}),
      })),
      ...(endpoint ? { endpoint } : {}),
      ...(combination.note ? { note: combination.note } : {}),
    }
  })
}

function inputCombinationsSupportFirstLastFrame(inputCombinations: ReturnType<typeof inputCombinationsFromCatalogModel>) {
  return inputCombinations.some((combination) => {
    const roles = new Set(combination.inputs.map((input) => input.role))
    return roles.has("first_frame_image") && roles.has("last_frame_image")
  })
}

function maxReferenceImagesFromInputCombinations(inputCombinations: ReturnType<typeof inputCombinationsFromCatalogModel>) {
  let maxReferenceImages: number | undefined
  for (const combination of inputCombinations) {
    for (const input of combination.inputs) {
      if (input.role !== "reference_image" || input.maxCount === undefined) continue
      maxReferenceImages = Math.max(maxReferenceImages ?? 0, input.maxCount)
    }
  }
  return maxReferenceImages
}

function catalogModelOfferingID(modelKey: string, model: RawCatalogModelSchemaOutput) {
  return model.offering_id?.trim() || model.catalog_id?.trim() || modelKey
}

function catalogModelProviderModelID(model: RawCatalogModelSchemaOutput) {
  return model.provider_model_id?.trim() || model.id
}

function catalogModelModalities(model: RawCatalogModelSchemaOutput) {
  const input = normalizeStringList(model.input_modalities ?? model.modalities?.input)
  const output = normalizeStringList(model.output_modalities ?? model.modalities?.output)
  return input.length > 0 || output.length > 0
    ? { input, output }
    : undefined
}

function manifestFromCatalogProvider(provider: RawCatalogProviderSchemaOutput): CinemaVideoProviderManifest {
  const models = Object.entries(provider.models ?? {})
    .map(([modelKey, model]) => {
      const offeringID = catalogModelOfferingID(modelKey, model)
      const providerModelID = catalogModelProviderModelID(model)
      const inputCombinations = inputCombinationsFromCatalogModel(model)
      const taskQueryEndpoint = normalizeCatalogTaskQueryEndpoint(model.task_query_endpoint)
      const supportsFirstLastFrame = model.supports_first_last_frame ?? inputCombinationsSupportFirstLastFrame(inputCombinations)
      const rawModes = model.modes ?? []
      const catalogModes = [...rawModes, ...inputCombinations.map((combination) => combination.mode)]
      const modes = normalizeModes(catalogModes)
      if (modes.length === 0) return null
      const modalities = catalogModelModalities(model)
      const maxReferenceImages = model.max_reference_images ?? maxReferenceImagesFromInputCombinations(inputCombinations)
      return {
        id: providerModelID,
        label: model.name,
        offeringID,
        providerModelID,
        catalogID: model.catalog_id ?? offeringID,
        ...(model.family ? { family: model.family } : {}),
        ...(model.lab ? { lab: model.lab } : {}),
        ...(model.base_model ? { baseModel: model.base_model } : {}),
        ...(model.endpoint_type ? { endpointType: model.endpoint_type } : {}),
        ...(modalities
          ? {
              modalities: {
                input: modalities.input,
                output: modalities.output,
              },
            }
          : {}),
        modes,
        durations: normalizeNumberList(model.limit?.durations),
        aspectRatios: normalizeStringList(model.limit?.aspect_ratios),
        resolutions: normalizeStringList(model.limit?.resolutions),
        ...(model.limit?.max_duration_seconds ? { maxDurationSeconds: model.limit.max_duration_seconds } : {}),
        inputCombinations,
        pricing: model.pricing,
        ...(model.source_url ? { sourceURL: model.source_url } : {}),
        ...(model.source_checked_at ? { sourceCheckedAt: model.source_checked_at } : {}),
        ...(maxReferenceImages !== undefined ? { maxReferenceImages } : {}),
        ...(model.supports_audio_output ?? model.audio_output ? { supportsAudio: true } : {}),
        ...(supportsFirstLastFrame ? { supportsFirstLastFrame: true } : {}),
        ...(model.requires_public_input_url !== undefined ? { requiresPublicInputURL: model.requires_public_input_url } : {}),
        ...(taskQueryEndpoint ? { taskQueryEndpoint } : {}),
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
    catalogSource: LOCAL_PROVIDER_MANIFEST_CATALOG_SOURCE,
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

type RawCatalogModelSchemaOutput = z.infer<typeof RawCatalogModelSchema>
type RawCatalogProviderSchemaOutput = z.infer<typeof RawCatalogProviderSchema>

async function catalogManifests(): Promise<CinemaVideoProviderManifest[]> {
  return await loadProviderManifests()
}

const providerAdapters: Record<string, ProviderAdapter> = {}

export function registerCinemaVideoProviderAdapter(providerID: string, adapter: ProviderAdapter) {
  providerAdapters[providerID] = adapter
}

export function hasCinemaVideoProviderAdapter(providerID: string) {
  return Boolean(providerAdapters[providerID])
}

function modelInputCombinationModes(model: CinemaVideoProviderManifest["models"][number]) {
  return (model.inputCombinations ?? []).map((combination) => combination.mode)
}

function cinemaVideoProviderAdapterSupportsInputCombination(
  providerID: string,
  model: CinemaVideoProviderManifest["models"][number],
  combination: CinemaProviderInputCombination,
) {
  const adapter = providerAdapters[providerID]
  if (!adapter) return false
  if (adapter.supportsInputCombination) return adapter.supportsInputCombination({ model, combination })
  if (adapter.supportedModes) return adapter.supportedModes.includes(combination.mode)
  return true
}

export function cinemaVideoProviderModelRuntimeSupportsMode(
  providerID: string,
  model: CinemaVideoProviderManifest["models"][number],
  mode: CinemaProviderModelMode,
) {
  const adapter = providerAdapters[providerID]
  if (!adapter) return false
  const combination = findCinemaVideoProviderInputCombinationForMode(model, mode)
  if (combination) return cinemaVideoProviderAdapterSupportsInputCombination(providerID, model, combination)
  if (adapter.supportedModes) return adapter.supportedModes.includes(mode)
  return model.modes.includes(mode)
}

function cinemaVideoProviderAdapterSupportedModes(manifest: CinemaVideoProviderManifest): CinemaProviderModelMode[] {
  const adapter = providerAdapters[manifest.id]
  if (!adapter) return []
  if (adapter.supportedModes) return [...adapter.supportedModes]
  const modes: CinemaProviderModelMode[] = []
  for (const model of manifest.models) {
    const combinations = model.inputCombinations ?? []
    if (combinations.length > 0) {
      for (const combination of combinations) {
        if (!cinemaVideoProviderAdapterSupportsInputCombination(manifest.id, model, combination)) continue
        modes.push(combination.mode)
      }
    } else {
      modes.push(...model.modes)
    }
  }
  return [...new Set(modes)]
}

function cinemaVideoProviderModelMatchesID(
  model: CinemaVideoProviderManifest["models"][number],
  modelID: string,
) {
  return [
    model.offeringID,
    model.catalogID,
    model.providerModelID,
    model.id,
  ].some((candidate) => candidate === modelID)
}

function cinemaVideoProviderModelSupportsMode(
  model: CinemaVideoProviderManifest["models"][number],
  mode: CinemaProviderModelMode,
) {
  return model.modes.includes(mode) || modelInputCombinationModes(model).includes(mode)
}

export function findCinemaVideoProviderModelForMode(
  manifest: CinemaVideoProviderManifest,
  modelID: string,
  mode: CinemaProviderModelMode,
) {
  return manifest.models.find((item) =>
    cinemaVideoProviderModelMatchesID(item, modelID) && cinemaVideoProviderModelSupportsMode(item, mode)
  )
    ?? manifest.models.find((item) => cinemaVideoProviderModelMatchesID(item, modelID))
}

export function cinemaVideoProviderModelSelectionID(model: CinemaVideoProviderManifest["models"][number]) {
  return model.offeringID ?? model.catalogID ?? model.id
}

export function cinemaVideoProviderTaskModelID(model: CinemaVideoProviderManifest["models"][number]) {
  return model.providerModelID ?? model.id
}

export function findCinemaVideoProviderInputCombinationForMode(
  model: CinemaVideoProviderManifest["models"][number],
  mode: CinemaProviderModelMode,
  requestedCombinationMode?: string,
) {
  const inputCombinations = model.inputCombinations ?? []
  const requested = requestedCombinationMode?.trim()
  if (requested) {
    const requestedCombination = inputCombinations.find((combination) => combination.mode === requested)
    if (requestedCombination) return requestedCombination
  }
  const exact = inputCombinations.find((combination) => combination.mode === mode)
  if (exact) return exact
  return null
}

function generationControlKey(input: CinemaProviderInputSpec) {
  return input.apiField?.trim() || input.role
}

function generationControlLabel(input: CinemaProviderInputSpec) {
  const explicitLabel = input.label?.trim()
  if (explicitLabel) return explicitLabel
  return generationControlKey(input)
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function generationControlBase(input: CinemaProviderInputSpec) {
  return {
    key: generationControlKey(input),
    label: generationControlLabel(input),
    required: input.required,
    ...(input.visibleWhen ? { visibleWhen: input.visibleWhen } : {}),
    ...(input.disabledWhen ? { disabledWhen: input.disabledWhen } : {}),
  }
}

function generationControlForInput(input: CinemaProviderInputSpec): GenerationControl {
  const base = generationControlBase(input)
  const uiControl = input.uiControl
  const modality = input.modality.trim().toLowerCase()
  const options = input.options?.filter((option) =>
    typeof option === "string" || typeof option === "number" || typeof option === "boolean"
  )

  if (uiControl === "textarea" || input.role === "prompt" || base.key === "prompt" || modality === "text") {
    return {
      ...base,
      type: "prompt",
      ...(input.maxLength ? { maxLength: input.maxLength } : {}),
      ...(typeof input.default === "string" ? { defaultValue: input.default } : {}),
    }
  }

  if (uiControl === "image-list" || modality === "image") {
    return {
      ...base,
      type: "image-list",
      minCount: input.minCount,
      ...(input.maxCount !== undefined ? { maxCount: input.maxCount } : {}),
      ...(input.supportedFormats ? { supportedFormats: input.supportedFormats } : {}),
      ...(input.maxFileSizeMB !== undefined ? { maxFileSizeMB: input.maxFileSizeMB } : {}),
    }
  }

  if ((uiControl === "select" || uiControl === "segmented" || options) && options && options.length > 0) {
    return {
      ...base,
      type: "select",
      options,
      ...(input.labels ? { labels: input.labels } : {}),
      ...("default" in input ? { defaultValue: input.default } : {}),
    }
  }

  if (uiControl === "number" || input.min !== undefined || input.max !== undefined) {
    return {
      ...base,
      type: "number",
      ...(input.min !== undefined ? { min: input.min } : {}),
      ...(input.max !== undefined ? { max: input.max } : {}),
      ...(typeof input.default === "number" ? { defaultValue: input.default } : {}),
    }
  }

  if (uiControl === "switch" || typeof input.default === "boolean") {
    return {
      ...base,
      type: "boolean",
      ...(typeof input.default === "boolean" ? { defaultValue: input.default } : {}),
    }
  }

  return {
    ...base,
    type: "json",
    ...("default" in input ? { defaultValue: input.default } : {}),
  }
}

function generationFormOutput(model: CinemaVideoProviderManifest["models"][number]): GenerationFormSpec["output"] {
  return model.modalities?.output.includes("image") || model.modes.some((mode) => mode.endsWith("-image") || mode === "image-edit" || mode === "omni-image")
    ? "image"
    : "video"
}

export function normalizeGenerationFormSpec(
  provider: CinemaVideoProviderManifest,
  model: CinemaVideoProviderManifest["models"][number],
  combination: CinemaProviderInputCombination,
): GenerationFormSpec {
  const controls = [...combination.inputs]
    .sort((a, b) => (a.uiOrder ?? Number.MAX_SAFE_INTEGER) - (b.uiOrder ?? Number.MAX_SAFE_INTEGER))
    .map((input) => generationControlForInput(input))

  return {
    providerID: provider.id,
    modelID: cinemaVideoProviderModelSelectionID(model),
    mode: combination.mode,
    output: generationFormOutput(model),
    controls,
  }
}

function normalizedGenerationFormSpecsForModel(
  provider: CinemaVideoProviderManifest,
  model: CinemaVideoProviderManifest["models"][number],
) {
  return (model.inputCombinations ?? [])
    .filter((combination) => combination.inputs.length > 0)
    .map((combination) => normalizeGenerationFormSpec(provider, model, combination))
}

function manifestWithNormalizedGenerationFormSpecs(manifest: CinemaVideoProviderManifest): CinemaVideoProviderManifest {
  return {
    ...manifest,
    models: manifest.models.map((model) => ({
      ...model,
      formSpecs: model.formSpecs.length > 0 ? model.formSpecs : normalizedGenerationFormSpecsForModel(manifest, model),
    })),
  }
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

type KlingAIEndpointKind = "text2video" | "image2video" | "image-generation" | "omni-image"
type KlingAIRequestMethod = "GET" | "POST"

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

function klingAICredentialProviderIDs(providerID: string) {
  const providerIDs = [`cinema-${providerID}`]
  if (isKlingAIProviderID(providerID) && providerID !== KLINGAI_PROVIDER_ID) {
    providerIDs.push(`cinema-${KLINGAI_PROVIDER_ID}`)
  }
  return [...new Set(providerIDs)]
}

function credentialProviderIDsForManifest(manifest: CinemaVideoProviderManifest) {
  const primaryCredentialProviderID = manifest.credentialProviderID ?? `cinema-${manifest.id}`
  const providerIDs = [primaryCredentialProviderID]
  if (isKlingAIProviderID(manifest.id) && manifest.id !== KLINGAI_PROVIDER_ID) {
    providerIDs.push(`cinema-${KLINGAI_PROVIDER_ID}`)
  }
  return [...new Set(providerIDs)]
}

async function klingAIBearerToken(providerID: string) {
  let apiKey: string | undefined
  for (const credentialProviderID of klingAICredentialProviderIDs(providerID)) {
    const runtimeAuth = await ProviderAuth.resolveProviderRuntimeAuth(credentialProviderID, {}, {
      method: "api-key",
      credentialMode: "active",
    })
    apiKey = runtimeAuth.apiKey?.trim()
    if (apiKey) break
  }
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

async function klingAIBaseURL(providerID: string) {
  const settings = await Config.getCinemaVideoProviderSettings(providerID)
  const configuredBaseURL = normalizeBaseURL(settings.baseURL)
  if (configuredBaseURL) return configuredBaseURL

  const manifest = (await catalogManifests()).find((item) => item.id === providerID)
  return normalizeCatalogBaseURL(manifest?.baseURL) ?? defaultKlingAIBaseURLForProvider(providerID)
}

function defaultBaseURLForProvider(manifest: CinemaVideoProviderManifest) {
  return (
    normalizeCatalogBaseURL(manifest.baseURL) ??
    (isKlingAIProviderID(manifest.id) ? defaultKlingAIBaseURLForProvider(manifest.id) : undefined)
  )
}

function klingAIEndpointPath(kind: KlingAIEndpointKind, taskID?: string) {
  const basePath = kind === "image-generation"
    ? "v1/images/generations"
    : kind === "omni-image"
      ? "v1/images/omni-image"
      : `v1/videos/${kind}`
  if (!taskID) return basePath
  return `${basePath}/${encodeURIComponent(taskID)}`
}

function klingAIEndpointKindFromPath(endpointPath: string): KlingAIEndpointKind | undefined {
  const normalized = endpointPath.replace(/^\/+/, "").toLowerCase()
  if (normalized.includes("images/omni-image") || normalized.includes("omni-image")) {
    return "omni-image"
  }
  if (
    normalized.includes("image-generation") ||
    normalized.includes("images/generations") ||
    normalized.includes("text-to-image") ||
    normalized.includes("image-to-image") ||
    normalized.includes("image-edit")
  ) {
    return "image-generation"
  }
  if (
    normalized.includes("image-to-video") ||
    normalized.includes("image2video") ||
    normalized.includes("frames-to-video") ||
    normalized.includes("reference-to-video")
  ) {
    return "image2video"
  }
  if (normalized.includes("text-to-video") || normalized.includes("text2video")) return "text2video"
  return undefined
}

function normalizedKlingAIEndpointPath(endpointPath: string, kind: KlingAIEndpointKind) {
  const normalized = endpointPath.trim().replace(/^\/+/, "")
  if (!normalized) return klingAIEndpointPath(kind)
  if (normalized.startsWith("v1/") || /^https?:\/\//i.test(normalized)) return normalized
  const legacyAliasKind = klingAILegacyEndpointAliasKind(normalized)
  return legacyAliasKind ? klingAIEndpointPath(legacyAliasKind) : normalized
}

function klingAILegacyEndpointAliasKind(endpointPath: string): KlingAIEndpointKind | undefined {
  const normalized = endpointPath.trim().replace(/^\/+|\/+$/g, "").toLowerCase()
  switch (normalized) {
    case "text-to-video":
    case "text2video":
      return "text2video"
    case "image-to-video":
    case "image2video":
    case "frames-to-video":
    case "reference-to-video":
      return "image2video"
    case "image-generation":
    case "images/generations":
    case "text-to-image":
    case "image-to-image":
    case "image-edit":
      return "image-generation"
    case "omni-image":
    case "images/omni-image":
      return "omni-image"
    default:
      return undefined
  }
}

function klingAITaskInputEndpoint(task: CinemaGenerationTask) {
  const endpoint = task.input.parameters.endpoint
  return isRecord(endpoint) ? endpoint : undefined
}

function klingAITaskInputQueryEndpoint(task: CinemaGenerationTask) {
  const direct = task.input.parameters.taskQueryEndpoint
  if (isRecord(direct)) return direct

  const endpoint = klingAITaskInputEndpoint(task)
  const nested = endpoint?.taskQuery ?? endpoint?.task_query
  return isRecord(nested) ? nested : undefined
}

function klingAIRequestMethodFromEndpoint(endpoint: Record<string, unknown> | undefined): KlingAIRequestMethod | undefined {
  const method = stringValue(endpoint?.method)?.toUpperCase()
  return method === "GET" || method === "POST" ? method : undefined
}

function klingAICreateEndpointForTask(task: CinemaGenerationTask) {
  const endpoint = klingAITaskInputEndpoint(task)
  const endpointPath = stringValue(endpoint?.path) ?? stringValue(endpoint?.url)
  const kind = endpointPath
    ? klingAIEndpointKindFromPath(endpointPath) ?? klingAIEndpointKindForMode(task.mode)
    : klingAIEndpointKindForMode(task.mode)
  return {
    kind,
    method: klingAIRequestMethodFromEndpoint(endpoint) ?? "POST",
    path: endpointPath ? normalizedKlingAIEndpointPath(endpointPath, kind) : klingAIEndpointPath(kind),
    taskQueryEndpoint: klingAITaskInputQueryEndpoint(task),
  }
}

function taskQueryEndpointFromProviderRef(task: CinemaGenerationTask) {
  const endpoint = task.providerTaskRef?.taskQueryEndpoint ?? task.providerTaskRef?.task_query_endpoint
  return isRecord(endpoint) ? endpoint : undefined
}

function renderKlingAITaskQueryEndpoint(endpoint: Record<string, unknown>, taskID: string) {
  const rawPath = stringValue(endpoint.path) ?? stringValue(endpoint.url)
  if (!rawPath) return undefined
  const encodedTaskID = encodeURIComponent(taskID)
  const rendered = rawPath
    .trim()
    .replace(/\{taskID\}|\{task_id\}/g, encodedTaskID)
  if (!rendered) return undefined
  if (rendered !== rawPath.trim()) return rendered

  const normalized = rendered.replace(/\/+$/, "")
  return normalized.endsWith(`/${encodedTaskID}`) ? normalized : `${normalized}/${encodedTaskID}`
}

function klingAIRefreshEndpointForTask(task: CinemaGenerationTask, kind: KlingAIEndpointKind, taskID: string) {
  const queryEndpoint = taskQueryEndpointFromProviderRef(task) ?? klingAITaskInputQueryEndpoint(task)
  const queryEndpointPath = queryEndpoint ? renderKlingAITaskQueryEndpoint(queryEndpoint, taskID) : undefined
  if (queryEndpointPath) {
    return {
      method: klingAIRequestMethodFromEndpoint(queryEndpoint) ?? "GET",
      path: queryEndpointPath,
    }
  }

  const endpointPath = stringValue(task.providerTaskRef?.endpoint)
  if (!endpointPath) return { method: "GET" as const, path: klingAIEndpointPath(kind, taskID) }
  const normalized = endpointPath.trim().replace(/\/+$/, "")
  if (!normalized) return { method: "GET" as const, path: klingAIEndpointPath(kind, taskID) }
  if (isKlingAITurboEndpointPath(normalized)) {
    return { method: "GET" as const, path: klingAITurboTaskQueryEndpointPath(normalized, taskID) }
  }
  const encodedTaskID = encodeURIComponent(taskID)
  return {
    method: "GET" as const,
    path: normalized.endsWith(`/${encodedTaskID}`) ? normalized : `${normalized}/${encodedTaskID}`,
  }
}

function isKlingAITurboEndpointPath(endpointPath: string) {
  return endpointPath.toLowerCase().includes("kling-3.0-turbo")
}

function klingAITurboTaskQueryEndpointPath(endpointPath: string, taskID: string) {
  const encodedTaskID = encodeURIComponent(taskID)
  if (/^https?:\/\//i.test(endpointPath)) {
    const url = new URL(endpointPath)
    url.pathname = `/${klingAITurboTaskQueryPath(url.pathname)}`
    url.search = `task_ids=${encodedTaskID}`
    return url.toString()
  }
  return `${klingAITurboTaskQueryPath(endpointPath)}?task_ids=${encodedTaskID}`
}

function klingAITurboTaskQueryPath(endpointPath: string) {
  const segments = endpointPath
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean)
  const endpointIndex = segments.findIndex((segment, index) => {
    const current = segment.toLowerCase()
    const next = segments[index + 1]?.toLowerCase()
    return (current === "text-to-video" || current === "image-to-video") && next === "kling-3.0-turbo"
  })
  const prefix = endpointIndex > 0 ? segments.slice(0, endpointIndex) : []
  return [...prefix, "tasks"].join("/")
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
  providerID: string,
  endpointPath: string,
  options: {
    method?: KlingAIRequestMethod
    body?: Record<string, unknown>
  } = {},
): Promise<KlingAIParsedResponse> {
  const baseURL = await klingAIBaseURL(providerID)
  const token = await klingAIBearerToken(providerID)
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
    data: isRecord(parsed.data)
      ? parsed.data
      : Array.isArray(parsed.data) && isRecord(parsed.data[0])
        ? parsed.data[0]
        : parsed,
  }
}

function klingAITaskIDFromResponse(response: KlingAIParsedResponse) {
  return stringValue(response.data?.task_id) ?? stringValue(response.data?.taskID) ?? stringValue(response.data?.id)
}

function klingAITaskStatusFromResponse(response: KlingAIParsedResponse): CinemaGenerationTask["status"] {
  const status = stringValue(response.data?.task_status) ?? stringValue(response.data?.status_name) ?? stringValue(response.data?.status)
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
    stringValue(response.data?.status_message) ??
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
    stringValue(response.data?.status_name) ??
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
      : Array.isArray(response.data?.works)
        ? response.data.works
        : Array.isArray(response.data?.outputs)
          ? response.data.outputs
          : Array.isArray(response.data?.assets)
            ? response.data.assets
            : []
  return videos.flatMap((item, index) => {
    if (typeof item === "string" && item.trim()) return [{ id: `kling-video-${index + 1}`, url: item.trim() }]
    if (!isRecord(item)) return []
    const nested = [item, item.video, item.resource, item.asset, item.output, item.file].filter(isRecord)
    const url = nested.map((candidate) =>
      stringValue(candidate.url) ??
      stringValue(candidate.video_url) ??
      stringValue(candidate.videoUrl) ??
      stringValue(candidate.download_url) ??
      stringValue(candidate.downloadUrl)
    ).find(Boolean)
    if (!url) return []
    return [{
      id: stringValue(item.id) ?? stringValue(item.work_id) ?? stringValue(item.asset_id),
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
  if (refKind === "text2video" || refKind === "image2video" || refKind === "image-generation" || refKind === "omni-image") return refKind
  const refEndpointKind = stringValue(task.providerTaskRef?.endpoint)
    ? klingAIEndpointKindFromPath(String(task.providerTaskRef?.endpoint))
    : undefined
  if (refEndpointKind) return refEndpointKind
  const inputEndpointPath = stringValue(klingAITaskInputEndpoint(task)?.path) ?? stringValue(klingAITaskInputEndpoint(task)?.url)
  const inputEndpointKind = inputEndpointPath ? klingAIEndpointKindFromPath(inputEndpointPath) : undefined
  if (inputEndpointKind) return inputEndpointKind
  return klingAIEndpointKindForMode(task.mode)
}

function klingAIEndpointKindForMode(mode: CinemaProviderModelMode): KlingAIEndpointKind {
  switch (mode) {
    case "text-to-video":
      return "text2video"
    case "image-to-video":
    case "frames-to-video":
      return "image2video"
    case "text-to-image":
      return "image-generation"
    case "omni-image":
      return "omni-image"
    default:
      throw new ApiError(400, "CINEMA_KLINGAI_MODE_UNSUPPORTED", `KlingAI adapter does not support mode '${mode}'.`)
  }
}

function klingAITaskRefFor(
  task: CinemaGenerationTask,
  taskID: string,
  endpoint: ReturnType<typeof klingAICreateEndpointForTask>,
) {
  const existingRef = isRecord(task.providerTaskRef) ? task.providerTaskRef : {}
  return {
    ...existingRef,
    providerID: task.providerID,
    taskID,
    kind: endpoint.kind,
    endpoint: endpoint.path,
    ...(endpoint.taskQueryEndpoint ? { taskQueryEndpoint: endpoint.taskQueryEndpoint } : {}),
  }
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

  if (input.task.mode === "text-to-image" || input.task.mode === "omni-image") {
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

function parameterNumberOrString(parameters: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = parameters[key]
    if (typeof value === "number" && Number.isFinite(value)) return value
    const string = stringValue(value)
    if (string) return string
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
  const explicit = parameterString(parameters, "klingMode", "qualityMode", "quality_mode", "mode")
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

function appendOptionalPayloadValue(
  target: Record<string, unknown>,
  outputKey: string,
  parameters: Record<string, unknown>,
  ...inputKeys: string[]
) {
  const value = parameterNumberOrString(parameters, ...inputKeys)
  if (value !== undefined) target[outputKey] = value
}

function appendOptionalPayloadNumber(
  target: Record<string, unknown>,
  outputKey: string,
  parameters: Record<string, unknown>,
  ...inputKeys: string[]
) {
  for (const key of inputKeys) {
    const value = parameters[key]
    if (typeof value === "number" && Number.isFinite(value)) {
      target[outputKey] = value
      return
    }
    const string = stringValue(value)
    if (!string) continue
    const number = Number.parseFloat(string)
    if (Number.isFinite(number)) {
      target[outputKey] = number
      return
    }
  }
}

function appendOptionalPayloadObject(
  target: Record<string, unknown>,
  outputKey: string,
  parameters: Record<string, unknown>,
  ...inputKeys: string[]
) {
  for (const key of inputKeys) {
    const value = parameters[key]
    if (isRecord(value)) {
      target[outputKey] = value
      return
    }
  }
}

function stringArrayValue(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.map((item) => stringValue(item)).filter((item): item is string => Boolean(item))
}

function parameterStringList(parameters: Record<string, unknown>, ...keys: string[]) {
  const values: string[] = []
  for (const key of keys) {
    values.push(...stringArrayValue(parameters[key]))
    const single = stringValue(parameters[key])
    if (single) values.push(single)
  }
  return normalizeStringList(values)
}

function klingAIElementListInput(parameters: Record<string, unknown>) {
  const values = [parameters.element_list, parameters.elementList]
  for (const value of values) {
    if (!Array.isArray(value)) continue
    const items: Record<string, unknown>[] = []
    for (const item of value) {
      if (isRecord(item)) {
        items.push(item)
        continue
      }
      if (typeof item === "number" && Number.isInteger(item) && item > 0) {
        items.push({ element_id: item })
        continue
      }
      const elementID = stringValue(item)
      if (elementID && /^\d+$/.test(elementID)) items.push({ element_id: Number(elementID) })
    }
    if (items.length > 0) return items
  }
  return []
}

function klingAIExternalTaskID(taskID: string) {
  return safeKlingAISegment(taskID).slice(0, 64)
}

async function klingAIImageInput(root: string, parameters: Record<string, unknown>, input: {
  urlKeys: string[]
  pathKeys: string[]
  missingCode: string
  missingMessage: string
  invalidURLMessage: string
  invalidSchemeMessage: string
  notFoundMessage: string
  invalidPathMessage: string
  tooLargeMessage: string
}) {
  const sourceImageURL = input.urlKeys.map((key) => stringValue(parameters[key])).find(Boolean)
  if (sourceImageURL) {
    let url: URL
    try {
      url = new URL(sourceImageURL)
    } catch {
      throw new ApiError(400, "CINEMA_KLINGAI_SOURCE_IMAGE_INVALID", input.invalidURLMessage)
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new ApiError(400, "CINEMA_KLINGAI_SOURCE_IMAGE_INVALID", input.invalidSchemeMessage)
    }
    return url.toString()
  }

  const sourceImagePath = input.pathKeys.map((key) => stringValue(parameters[key])).find(Boolean)
  if (!sourceImagePath) {
    throw new ApiError(
      400,
      input.missingCode,
      input.missingMessage,
    )
  }

  const filePath = resolveProjectRelativeFile(root, sourceImagePath)
  const fileStat = await stat(filePath).catch((error: unknown) => {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new ApiError(404, "CINEMA_KLINGAI_SOURCE_IMAGE_NOT_FOUND", input.notFoundMessage)
    }
    throw error
  })
  if (!fileStat.isFile()) {
    throw new ApiError(400, "CINEMA_KLINGAI_SOURCE_IMAGE_INVALID", input.invalidPathMessage)
  }
  if (fileStat.size > 25 * 1024 * 1024) {
    throw new ApiError(413, "CINEMA_KLINGAI_SOURCE_IMAGE_TOO_LARGE", input.tooLargeMessage)
  }

  return Buffer.from(await readFile(filePath)).toString("base64")
}

async function klingAISourceImageInput(root: string, parameters: Record<string, unknown>) {
  return await klingAIImageInput(root, parameters, {
    urlKeys: ["sourceImageURL", "imageURL"],
    pathKeys: ["sourceImagePath", "imagePath"],
    missingCode: "CINEMA_KLINGAI_SOURCE_IMAGE_REQUIRED",
    missingMessage: "Image-to-video requires a source image. Connect an image node with a generated asset before submitting.",
    invalidURLMessage: "KlingAI source image URL must be a valid absolute URL.",
    invalidSchemeMessage: "KlingAI source image URL must use http or https.",
    notFoundMessage: "KlingAI source image asset was not found.",
    invalidPathMessage: "KlingAI source image path must point to a file.",
    tooLargeMessage: "KlingAI source image is too large.",
  })
}

async function klingAIOmniImageListItemInput(root: string, value: string) {
  const trimmed = value.trim()
  const isRemoteURL = /^https?:\/\//i.test(trimmed)
  return await klingAIImageInput(root, isRemoteURL ? { imageURL: trimmed } : { imagePath: trimmed }, {
    urlKeys: ["imageURL"],
    pathKeys: ["imagePath"],
    missingCode: "CINEMA_KLINGAI_OMNI_IMAGE_REQUIRED",
    missingMessage: "KlingAI Omni image input is missing.",
    invalidURLMessage: "KlingAI Omni image URL must be a valid absolute URL.",
    invalidSchemeMessage: "KlingAI Omni image URL must use http or https.",
    notFoundMessage: "KlingAI Omni image asset was not found.",
    invalidPathMessage: "KlingAI Omni image path must point to a file.",
    tooLargeMessage: "KlingAI Omni image is too large.",
  })
}

async function klingAIExplicitImageListInput(root: string, parameters: Record<string, unknown>) {
  const values = [parameters.image_list, parameters.imageList]
  for (const value of values) {
    if (!Array.isArray(value)) continue
    const items: Array<{ image: string }> = []
    for (const item of value) {
      const directImage = stringValue(item)
      if (directImage) {
        items.push({ image: await klingAIOmniImageListItemInput(root, directImage) })
        continue
      }
      if (!isRecord(item)) continue
      const image = parameterString(item, "image", "url", "imageURL", "sourceImageURL", "path", "imagePath", "sourceImagePath")
      if (image) items.push({ image: await klingAIOmniImageListItemInput(root, image) })
    }
    if (items.length > 0) return items
  }
  return []
}

async function klingAIOmniImageListInput(root: string, parameters: Record<string, unknown>) {
  const explicit = await klingAIExplicitImageListInput(root, parameters)
  if (explicit.length > 0) return explicit.slice(0, 10)

  const urlInputs = parameterStringList(
    parameters,
    "imageListURLs",
    "image_list_urls",
    "referenceImageURLs",
    "referenceImageURL",
    "sourceImageURLs",
    "sourceImageURL",
    "imageURLs",
    "imageURL",
  )
  const pathInputs = parameterStringList(
    parameters,
    "imageListPaths",
    "image_list_paths",
    "referenceImagePaths",
    "referenceImagePath",
    "sourceImagePaths",
    "sourceImagePath",
    "imagePaths",
    "imagePath",
  )
  const images: Array<{ image: string }> = []
  for (const imageURL of urlInputs) {
    images.push({
      image: await klingAIImageInput(root, { imageURL }, {
        urlKeys: ["imageURL"],
        pathKeys: [],
        missingCode: "CINEMA_KLINGAI_OMNI_IMAGE_REQUIRED",
        missingMessage: "KlingAI Omni image input is missing.",
        invalidURLMessage: "KlingAI Omni image URL must be a valid absolute URL.",
        invalidSchemeMessage: "KlingAI Omni image URL must use http or https.",
        notFoundMessage: "KlingAI Omni image asset was not found.",
        invalidPathMessage: "KlingAI Omni image path must point to a file.",
        tooLargeMessage: "KlingAI Omni image is too large.",
      }),
    })
  }
  for (const imagePath of pathInputs) {
    images.push({
      image: await klingAIImageInput(root, { imagePath }, {
        urlKeys: [],
        pathKeys: ["imagePath"],
        missingCode: "CINEMA_KLINGAI_OMNI_IMAGE_REQUIRED",
        missingMessage: "KlingAI Omni image input is missing.",
        invalidURLMessage: "KlingAI Omni image URL must be a valid absolute URL.",
        invalidSchemeMessage: "KlingAI Omni image URL must use http or https.",
        notFoundMessage: "KlingAI Omni image asset was not found.",
        invalidPathMessage: "KlingAI Omni image path must point to a file.",
        tooLargeMessage: "KlingAI Omni image is too large.",
      }),
    })
  }
  return images.slice(0, 10)
}

async function klingAIStartFrameInput(root: string, parameters: Record<string, unknown>) {
  return await klingAIImageInput(root, parameters, {
    urlKeys: ["startFrameURL", "startImageURL", "sourceImageURL", "imageURL"],
    pathKeys: ["startFramePath", "startImagePath", "sourceImagePath", "imagePath"],
    missingCode: "CINEMA_KLINGAI_START_FRAME_REQUIRED",
    missingMessage: "Start/end frame video requires a start frame image.",
    invalidURLMessage: "KlingAI start frame URL must be a valid absolute URL.",
    invalidSchemeMessage: "KlingAI start frame URL must use http or https.",
    notFoundMessage: "KlingAI start frame asset was not found.",
    invalidPathMessage: "KlingAI start frame path must point to a file.",
    tooLargeMessage: "KlingAI start frame image is too large.",
  })
}

async function klingAIEndFrameInput(root: string, parameters: Record<string, unknown>) {
  return await klingAIImageInput(root, parameters, {
    urlKeys: ["endFrameURL", "endImageURL", "imageTailURL", "image_tail_url"],
    pathKeys: ["endFramePath", "endImagePath", "imageTailPath", "image_tail_path"],
    missingCode: "CINEMA_KLINGAI_END_FRAME_REQUIRED",
    missingMessage: "Start/end frame video requires an end frame image.",
    invalidURLMessage: "KlingAI end frame URL must be a valid absolute URL.",
    invalidSchemeMessage: "KlingAI end frame URL must use http or https.",
    notFoundMessage: "KlingAI end frame asset was not found.",
    invalidPathMessage: "KlingAI end frame path must point to a file.",
    tooLargeMessage: "KlingAI end frame image is too large.",
  })
}

function hasKlingAIImageInput(parameters: Record<string, unknown>) {
  return Boolean(
    stringValue(parameters.sourceImageURL) ??
    stringValue(parameters.imageURL) ??
    stringValue(parameters.sourceImagePath) ??
    stringValue(parameters.imagePath)
  )
}

function hasKlingAIStartFrameInput(parameters: Record<string, unknown>) {
  return Boolean(
    stringValue(parameters.startFrameURL) ??
    stringValue(parameters.startImageURL) ??
    stringValue(parameters.startFramePath) ??
    stringValue(parameters.startImagePath)
  )
}

function hasKlingAIEndFrameInput(parameters: Record<string, unknown>) {
  return Boolean(
    stringValue(parameters.endFrameURL) ??
    stringValue(parameters.endImageURL) ??
    stringValue(parameters.imageTailURL) ??
    stringValue(parameters.image_tail_url) ??
    stringValue(parameters.endFramePath) ??
    stringValue(parameters.endImagePath) ??
    stringValue(parameters.imageTailPath) ??
    stringValue(parameters.image_tail_path)
  )
}

function hasKlingAIStartEndFrameInput(parameters: Record<string, unknown>) {
  const hasStartFrame = hasKlingAIStartFrameInput(parameters)
  const hasEndFrame = hasKlingAIEndFrameInput(parameters)
  return hasStartFrame && hasEndFrame
}

function klingAITurboSettings(parameters: Record<string, unknown>, input: { includeAspectRatio: boolean }) {
  const settings: Record<string, unknown> = {}
  appendOptionalPayloadValue(settings, "resolution", parameters, "resolution")
  appendOptionalPayloadValue(settings, "duration", parameters, "duration")
  if (input.includeAspectRatio) appendOptionalPayloadValue(settings, "aspect_ratio", parameters, "aspectRatio", "aspect_ratio")
  return settings
}

function klingAITurboOptions(task: CinemaGenerationTask) {
  return {
    external_task_id: klingAIExternalTaskID(task.id),
  }
}

function klingAITurboImageContent(image: string) {
  if (/^https?:\/\//i.test(image)) {
    return {
      type: "first_frame",
      url: image,
    }
  }
  return {
    type: "first_frame",
    image,
  }
}

async function klingAITurboTaskPayload(input: ProviderAdapterCreateInput, kind: KlingAIEndpointKind) {
  const parameters = input.task.input.parameters
  if (kind === "text2video") {
    return {
      prompt: input.task.input.prompt,
      settings: klingAITurboSettings(parameters, { includeAspectRatio: true }),
      options: klingAITurboOptions(input.task),
    }
  }

  if (kind === "image2video") {
    const contents: Record<string, unknown>[] = []
    if (input.task.input.prompt.trim()) {
      contents.push({
        type: "prompt",
        text: input.task.input.prompt,
      })
    }
    contents.push(klingAITurboImageContent(
      await (hasKlingAIStartFrameInput(parameters)
        ? klingAIStartFrameInput(input.root, parameters)
        : klingAISourceImageInput(input.root, parameters))
    ))
    return {
      contents,
      settings: klingAITurboSettings(parameters, { includeAspectRatio: false }),
      options: klingAITurboOptions(input.task),
    }
  }

  return {
    prompt: promptWithStyle(input.task.input.prompt, parameters),
    settings: klingAITurboSettings(parameters, { includeAspectRatio: true }),
    options: klingAITurboOptions(input.task),
  }
}

async function klingAITaskPayload(input: ProviderAdapterCreateInput, kind: KlingAIEndpointKind, endpointPath?: string) {
  if (endpointPath && isKlingAITurboEndpointPath(endpointPath)) return await klingAITurboTaskPayload(input, kind)

  const parameters = input.task.input.parameters
  const isImageKind = kind === "image-generation" || kind === "omni-image"
  const isVideoKind = kind === "text2video" || kind === "image2video"
  const omniResultType = kind === "omni-image" ? parameterString(parameters, "resultType", "result_type") : undefined
  const payload: Record<string, unknown> = {
    model_name: input.task.modelID,
    prompt: isImageKind ? promptWithStyle(input.task.input.prompt, parameters) : input.task.input.prompt,
    external_task_id: klingAIExternalTaskID(input.task.id),
  }

  appendOptionalPayloadString(payload, "aspect_ratio", parameters, "aspectRatio", "aspect_ratio")
  if (kind === "image-generation" && !payload.aspect_ratio) {
    const aspectRatio = aspectRatioFromSize(parameterString(parameters, "size"))
    if (aspectRatio) payload.aspect_ratio = aspectRatio
  }
  if (isVideoKind) appendOptionalPayloadString(payload, "duration", parameters, "duration")
  if (kind !== "omni-image") {
    appendOptionalPayloadString(payload, "negative_prompt", parameters, "negativePrompt", "negative_prompt")
    appendOptionalPayloadNumber(payload, "cfg_scale", parameters, "cfgScale", "cfg_scale")
  }
  if (isImageKind) appendOptionalPayloadString(payload, "resolution", parameters, "resolution")
  if (isVideoKind) {
    appendOptionalPayloadString(payload, "sound", parameters, "sound")
    appendOptionalPayloadObject(payload, "camera_control", parameters, "cameraControl", "camera_control")
  }
  appendOptionalPayloadObject(payload, "watermark_info", parameters, "watermarkInfo", "watermark_info")
  if (kind === "omni-image") {
    if (omniResultType) payload.result_type = omniResultType
    if (omniResultType === "series") appendOptionalPayloadValue(payload, "series_amount", parameters, "seriesAmount", "series_amount")
    const elementList = klingAIElementListInput(parameters)
    if (elementList.length > 0) payload.element_list = elementList
    const imageList = await klingAIOmniImageListInput(input.root, parameters)
    if (imageList.length > 0) payload.image_list = imageList
  }
  const count = Number(parameters.count)
  if (Number.isInteger(count) && count > 0 && !(kind === "omni-image" && omniResultType === "series")) payload.n = count
  if (isVideoKind) payload.mode = klingAIQualityMode(parameters)

  if (hasKlingAIStartEndFrameInput(parameters)) {
    payload.image = await klingAIStartFrameInput(input.root, parameters)
    payload.image_tail = await klingAIEndFrameInput(input.root, parameters)
  } else if (kind === "image2video" && hasKlingAIStartFrameInput(parameters)) {
    payload.image = await klingAIStartFrameInput(input.root, parameters)
  } else if (kind === "image2video" || (kind === "image-generation" && hasKlingAIImageInput(parameters))) {
    payload.image = await klingAISourceImageInput(input.root, parameters)
  }

  return payload
}

const KlingAIProviderAdapter: ProviderAdapter = {
  manifest: {} as CinemaVideoProviderManifest,
  supportsInputCombination: ({ combination }) => {
    const endpointPath = stringValue(combination.endpoint?.path) ?? stringValue(combination.endpoint?.url)
    if (endpointPath) return Boolean(klingAIEndpointKindFromPath(endpointPath))
    try {
      klingAIEndpointKindForMode(combination.mode)
      return true
    } catch {
      return false
    }
  },
  createTask: async (input) => {
    const endpoint = klingAICreateEndpointForTask(input.task)
    const payload = await klingAITaskPayload(input, endpoint.kind, endpoint.path)
    const response = await requestKlingAI(input.task.providerID, endpoint.path, {
      method: endpoint.method,
      body: payload,
    })
    const providerTaskID = klingAITaskIDFromResponse(response)
    if (!providerTaskID) {
      throw new ApiError(502, "CINEMA_KLINGAI_TASK_ID_MISSING", "KlingAI did not return a task ID.")
    }

    const task = taskUpdated(input.task, {
      providerTaskRef: klingAITaskRefFor(input.task, providerTaskID, endpoint),
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
    const endpoint = klingAIRefreshEndpointForTask(input.task, kind, providerTaskID)
    const response = await requestKlingAI(input.task.providerID, endpoint.path, { method: endpoint.method })
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

for (const providerID of KLINGAI_PROVIDER_IDS) {
  registerCinemaVideoProviderAdapter(providerID, KlingAIProviderAdapter)
}

export function assertCinemaVideoProviderModelSupports(
  input: CreateCinemaGenerationTaskBody,
  manifest: CinemaVideoProviderManifest,
) {
  const model = findCinemaVideoProviderModelForMode(manifest, input.modelID, input.mode)
  if (!model) {
    throw new ApiError(400, "CINEMA_PROVIDER_MODEL_NOT_FOUND", `Cinema provider '${manifest.id}' does not expose model '${input.modelID}'.`)
  }
  if (!model.modes.includes(input.mode)) {
    const hasCombinationMode = modelInputCombinationModes(model).includes(input.mode)
    if (!hasCombinationMode) {
      throw new ApiError(400, "CINEMA_PROVIDER_MODE_UNSUPPORTED", `Model '${input.modelID}' does not support mode '${input.mode}'.`)
    }
  }
  const combination = findCinemaVideoProviderInputCombinationForMode(
    model,
    input.mode,
    typeof input.parameters.inputCombinationMode === "string" ? input.parameters.inputCombinationMode : undefined,
  )
  if ((model.inputCombinations ?? []).length > 0 && !combination) {
    throw new ApiError(400, "CINEMA_PROVIDER_MODE_UNSUPPORTED", `Model '${input.modelID}' does not expose input combination '${input.mode}'.`)
  }
  if (
    providerAdapters[manifest.id] &&
    combination &&
    !cinemaVideoProviderAdapterSupportsInputCombination(manifest.id, model, combination)
  ) {
    throw new ApiError(400, "CINEMA_PROVIDER_MODE_UNSUPPORTED", `Cinema provider '${manifest.id}' runtime does not support input combination '${combination.mode}'.`)
  }
  return model
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

  let runtimeAuth: Awaited<ReturnType<typeof ProviderAuth.resolveProviderRuntimeAuth>> | undefined
  let resolvedCredentialProviderID = credentialProviderID
  for (const candidateCredentialProviderID of credentialProviderIDsForManifest(manifest)) {
    const candidateRuntimeAuth = await ProviderAuth.resolveProviderRuntimeAuth(candidateCredentialProviderID, {}, {
      method: "api-key",
      credentialMode: "active",
    })
    if (!runtimeAuth || candidateRuntimeAuth.apiKey) {
      runtimeAuth = candidateRuntimeAuth
      resolvedCredentialProviderID = candidateCredentialProviderID
    }
    if (candidateRuntimeAuth.apiKey) break
  }
  if (!runtimeAuth) {
    throw new ApiError(500, "CINEMA_PROVIDER_AUTH_UNAVAILABLE", `Cinema provider '${manifest.id}' auth state could not be resolved.`)
  }
  const connected = Boolean(runtimeAuth.apiKey)
  return {
    providerID: manifest.id,
    credentialProviderID: resolvedCredentialProviderID,
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
        supportedModes: cinemaVideoProviderAdapterSupportedModes(manifest),
      }
    : { adapterAvailable, supportedModes: [] }
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
  const runtimeManifest = manifestWithNormalizedGenerationFormSpecs(manifest)
  const runtime = await providerRuntimeFor(manifest)
  return {
    manifest: runtimeManifest,
    auth: await providerAuthStateFor(runtimeManifest),
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

  for (const credentialProviderID of credentialProviderIDsForManifest(manifest)) {
    const runtimeAuth = await ProviderAuth.resolveProviderRuntimeAuth(credentialProviderID, {}, {
      method: "api-key",
      credentialMode: "active",
    })
    const apiKey = runtimeAuth.apiKey?.trim()
    if (apiKey) return apiKey
  }
  return undefined
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
