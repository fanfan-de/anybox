import { randomUUID } from "node:crypto"
import { appendFile, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import {
  CinemaCanvasDocumentSchema,
  CinemaGenerationTaskSchema,
  CinemaImageNodeAssetSchema,
  CinemaProjectDirectoryListingSchema,
  CinemaProjectEventSchema,
  type CinemaGeneratedAsset,
  type CinemaAssetRef,
  type CinemaImageGenerationResult,
  type CinemaImportedImageAssetResult,
  type CinemaImageModel,
  type CinemaImageModelsResult,
  type CinemaProjectDirectoryEntry,
  type CinemaProjectDirectoryListing,
  type CinemaTextGenerationResult,
  type CinemaTextModel,
  type CinemaTextModelsResult,
  type CinemaGenerationProgress,
  type CinemaGenerationTask,
  type CinemaGenerationTaskStatus,
  type CinemaCanvasNode,
  type CinemaCanvasDocument,
  type CinemaCommand,
  type CinemaCommandResult,
  type CinemaCustomApiAuthState,
  type CinemaCustomApiOutput,
  type CinemaCustomApiRunResult,
  type CinemaEventsResult,
  type GenerationFormSpec,
  type CinemaNodeType,
  type CinemaOpenLink,
  type CinemaProjectEvent,
  type CinemaProjectSummary,
  type CinemaProjectStateSummary,
  type CreateCinemaCustomApiRunBody,
  type CreateCinemaGenerationTaskBody,
  type CreateCinemaImageGenerationBody,
  type CreateCinemaImportedImageAssetBody,
  type CreateCinemaTextGenerationBody,
} from "@anybox/shared/cinema"
import { isSshWorkspaceUri } from "@anybox/shared"
import {
  type CinemaTimelineCommand,
  type CinemaTimelineCommandResult,
  type CinemaTimelineDocument,
  type CinemaTimelineEventsResult,
  type CinemaTimelineListResult,
  type DeleteCinemaTimelineResult,
  type CreateCinemaTimelineBody,
} from "@anybox/shared/cinema-timeline"
import * as ProviderAuth from "#auth/provider-auth.ts"
import * as CinemaProviderRuntime from "#cinema/provider-runtime.ts"
import * as CinemaAssetLibrary from "#cinema/asset-library.ts"
import * as CinemaTimelineStorage from "#cinema/timeline-storage.ts"
import { applyCinemaTimelineCommandToDocument } from "#cinema/timeline-commands.ts"
import * as CinemaTimelineWaveform from "#cinema/timeline-waveform.ts"
import { streamCinemaFile } from "#cinema/file-range-stream.ts"
import * as Config from "#config/config.ts"
import * as ModelRegistry from "#model/registry.ts"
import * as ModelRuntime from "#model/runtime.ts"
import type { PublicModel } from "#model/types.ts"
import * as Project from "#project/project.ts"
import { Instance } from "#project/instance.ts"
import { InitError } from "#provider/provider.ts"
import { ApiError } from "#server/error.ts"
import { getServerBaseURL } from "#server/base-url.ts"
import { getProcessEnvValue } from "#env/compat.ts"
import {
  isSupportedImageMime,
  readImageDimensions,
} from "#session/support/image-assets.ts"
import {
  listProjectModelsWithFallback,
  resolveEffectiveModelWithFallback,
  resolveProjectModelSelectionWithGlobalFallback,
} from "#server/usecases/model-list-cache.ts"
import * as Log from "#util/log.ts"
import * as Lock from "#util/lock.ts"

type GenerateTextFunction = typeof import("ai")["generateText"]
type CinemaProjectAssetRange = {
  start: number
  end: number
  total: number
}
type ReadCinemaProjectAssetOptions = {
  rangeHeader?: string | null
}

export {
  setCinemaVideoProviderAdapterForTest,
  setCinemaVideoProviderCatalogCacheFileForTest,
  setCinemaVideoProviderCatalogForTest,
} from "#cinema/provider-runtime.ts"

const defaultCinemaTextRuntimeDependencies = {
  getGenerateText: async () => (await import("ai")).generateText,
  getLanguage: ModelRuntime.getLanguage,
  getModel: ModelRegistry.getAISDKModel,
  listModels: listProjectModelsWithFallback,
  resolveEffectiveModel: resolveEffectiveModelWithFallback,
  resolveSelection: resolveProjectModelSelectionWithGlobalFallback,
}
let cinemaTextRuntimeDependencies = defaultCinemaTextRuntimeDependencies

const defaultCinemaImageRuntimeDependencies = {
  getImageGenerationSettings: Config.getImageGenerationSettings,
}
let cinemaImageRuntimeDependencies = defaultCinemaImageRuntimeDependencies

export function setCinemaTextRuntimeDependenciesForTest(
  overrides: Partial<typeof defaultCinemaTextRuntimeDependencies>,
) {
  const previous = cinemaTextRuntimeDependencies
  cinemaTextRuntimeDependencies = {
    ...previous,
    ...overrides,
  }

  return () => {
    cinemaTextRuntimeDependencies = previous
  }
}

export function setCinemaImageRuntimeDependenciesForTest(
  overrides: Partial<typeof defaultCinemaImageRuntimeDependencies>,
) {
  const previous = cinemaImageRuntimeDependencies
  cinemaImageRuntimeDependencies = {
    ...previous,
    ...overrides,
  }

  return () => {
    cinemaImageRuntimeDependencies = previous
  }
}

const CINEMA_DIRECTORY = ".anybox-cinema"
const CANVAS_FILE = "canvas.json"
const PROJECT_FILE = "project.json"
const EVENTS_FILE = "events.jsonl"
const PROVIDERS_FILE = "providers.json"
const TASKS_FILE = "tasks.jsonl"
const TASKS_DIRECTORY = "tasks"
const PROJECT_DIRECTORIES = ["assets", "references", "prompts", "generated", "renders", "exports"] as const
const PROJECT_DIRECTORY_LIST_LIMIT = 250
const PROJECT_DIRECTORY_SKIPPED_NAMES = new Set([".git", "node_modules"])
const CINEMA_PROJECT_IMAGE_ASSET_MAX_BYTES = 25 * 1024 * 1024
const CINEMA_PROJECT_VIDEO_ASSET_MAX_BYTES = 256 * 1024 * 1024
const CINEMA_CUSTOM_API_DEFAULT_TIMEOUT_MS = 30 * 1000
const CINEMA_CUSTOM_API_MAX_TIMEOUT_MS = 60 * 1000
const CINEMA_CUSTOM_API_MAX_RESPONSE_BYTES = 5 * 1024 * 1024
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
const VIDEO_MIME_BY_EXTENSION: Record<string, string> = {
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
}
const CINEMA_IMAGE_GENERATION_MODES = ["text-to-image", "omni-image"] as const
type CinemaImageGenerationMode = typeof CINEMA_IMAGE_GENERATION_MODES[number]

function isCinemaImageGenerationMode(mode: string): mode is CinemaImageGenerationMode {
  return (CINEMA_IMAGE_GENERATION_MODES as readonly string[]).includes(mode)
}

const CINEMA_VIDEO_GENERATION_MODES = new Set([
  "text-to-video",
  "image-to-video",
  "frames-to-video",
  "reference-to-video",
  "video-to-video",
  "edit",
  "extend",
  "motion-control",
])

function isCinemaVideoGenerationMode(mode: string) {
  const normalized = mode.trim().toLowerCase()
  return CINEMA_VIDEO_GENERATION_MODES.has(normalized) ||
    normalized.includes("-to-video") ||
    normalized.endsWith("-video")
}

const nowISO = () => new Date().toISOString()
const log = Log.create({ service: "cinema" })

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function safeReadProject(projectID: string) {
  const project = Project.get(projectID)
  if (!project) {
    throw new ApiError(404, "PROJECT_NOT_FOUND", `Project '${projectID}' not found`)
  }
  return project
}

function resolveCinemaRoot(projectID: string) {
  const project = safeReadProject(projectID)
  const root = Project.getRepositoryRoot(project)
  if (isSshWorkspaceUri(root)) {
    throw new ApiError(409, "CINEMA_UNAVAILABLE_FOR_SSH", "Cinema projects are not available for SSH workspaces yet.")
  }

  return {
    project,
    root,
    cinemaRoot: path.join(root, CINEMA_DIRECTORY),
  }
}

async function readOptionalJson(filePath: string) {
  const raw = await readFile(filePath, "utf8").catch((error: unknown) => {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null
    throw error
  })
  if (raw === null) return undefined
  return JSON.parse(raw) as Record<string, unknown>
}

async function pathExists(filePath: string) {
  return await stat(filePath)
    .then(() => true)
    .catch((error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false
      throw error
    })
}

function createInvalidJsonError(fileLabel: string, error: unknown) {
  const message = error instanceof Error && error.message.trim() ? error.message : "Invalid JSON"
  return new ApiError(409, "CINEMA_METADATA_INVALID", `${fileLabel} is invalid: ${message}`)
}

async function assertCinemaProjectInitialized(cinemaRoot: string) {
  const projectPath = path.join(cinemaRoot, PROJECT_FILE)
  if (!(await pathExists(projectPath))) {
    throw new ApiError(
      404,
      "CINEMA_PROJECT_NOT_INITIALIZED",
      "This project has not been initialized for anybox for cinema yet.",
    )
  }
}

function stripLegacyCustomNodesFromCanvasInput(input: unknown) {
  const legacyCustomNodeType = "custom-node"
  if (!isRecord(input)) return input

  const rawNodes = Array.isArray(input.nodes) ? input.nodes : []
  const legacyNodeIDs = new Set<string>()
  const nodes = rawNodes.filter((node) => {
    if (!isRecord(node) || node.type !== legacyCustomNodeType) return true
    if (typeof node.id === "string") legacyNodeIDs.add(node.id)
    return false
  })

  const edges = Array.isArray(input.edges)
    ? input.edges.filter((edge) => {
        if (!isRecord(edge)) return true
        const source = typeof edge.source === "string" ? edge.source : ""
        const target = typeof edge.target === "string" ? edge.target : ""
        return !legacyNodeIDs.has(source) && !legacyNodeIDs.has(target)
      })
    : input.edges
  const nodeTypes = Array.isArray(input.nodeTypes)
    ? input.nodeTypes.filter((type) => type !== legacyCustomNodeType)
    : input.nodeTypes
  const { customNodeDefinitions: _customNodeDefinitions, ...rest } = input

  return {
    ...rest,
    nodes,
    edges,
    nodeTypes,
  }
}

function parseCinemaImageNodeAsset(input: unknown): CinemaGeneratedAsset | undefined {
  const parsed = CinemaImageNodeAssetSchema.safeParse(input)
  return parsed.success ? parsed.data : undefined
}

function parseCinemaImageNodeAssets(input: unknown): CinemaGeneratedAsset[] {
  if (!Array.isArray(input)) return []
  return input.flatMap((item) => {
    const asset = parseCinemaImageNodeAsset(item)
    return asset ? [asset] : []
  })
}

function normalizeCinemaImageNodeData(input: unknown) {
  if (!isRecord(input)) return input

  const nextData: Record<string, unknown> = { ...input }
  const directAsset = parseCinemaImageNodeAsset(input.asset)
  const legacyResultAssets = parseCinemaImageNodeAssets(input.resultAssets)
  const legacySelectedAssetID = stringValue(input.selectedAssetID)
  const legacySelectedAsset = (
    legacySelectedAssetID
      ? legacyResultAssets.find((asset) => asset.id === legacySelectedAssetID)
      : undefined
  ) ?? legacyResultAssets[0]
  const promotedLegacyAsset = directAsset ? undefined : legacySelectedAsset
  const candidateAssets = parseCinemaImageNodeAssets(input.candidateAssets)
  const finalAsset = directAsset ?? promotedLegacyAsset

  if (finalAsset) nextData.asset = finalAsset
  else delete nextData.asset

  if (finalAsset) {
    delete nextData.candidateAssets
    delete nextData.selectedCandidateAssetID
  } else if (candidateAssets.length > 0) {
    nextData.candidateAssets = candidateAssets
    const selectedCandidateAssetID = stringValue(input.selectedCandidateAssetID)
    nextData.selectedCandidateAssetID = candidateAssets.some((asset) => asset.id === selectedCandidateAssetID)
      ? selectedCandidateAssetID
      : candidateAssets[0]!.id
  } else {
    delete nextData.candidateAssets
    delete nextData.selectedCandidateAssetID
  }

  if (promotedLegacyAsset) {
    nextData.sourceKind = "generation"
  } else if (!["upload", "generation", "crop"].includes(String(nextData.sourceKind ?? ""))) {
    if (directAsset) nextData.sourceKind = input.derivedOperation === "crop" ? "crop" : "upload"
    else if (!finalAsset && candidateAssets.length > 0) nextData.sourceKind = "generation"
    else delete nextData.sourceKind
  }

  delete nextData.resultAssets
  delete nextData.selectedAssetID

  return nextData
}

function normalizeCinemaCanvasInput(input: unknown) {
  if (!isRecord(input)) return input

  const nodes = Array.isArray(input.nodes)
    ? input.nodes.map((node) => {
        if (!isRecord(node)) return node
        const type = node.type === "local-image" ? "image" : node.type
        if (type !== "image") return node
        return {
          ...node,
          type,
          ...(node.data === undefined ? {} : { data: normalizeCinemaImageNodeData(node.data) }),
        }
      })
    : input.nodes

  const nodeTypes = new Set<unknown>()
  if (Array.isArray(input.nodeTypes)) {
    for (const type of input.nodeTypes) nodeTypes.add(type === "local-image" ? "image" : type)
  }
  if (Array.isArray(nodes)) {
    for (const node of nodes) {
      if (isRecord(node) && typeof node.type === "string") nodeTypes.add(node.type)
    }
  }

  return {
    ...input,
    nodes,
    nodeTypes: [...nodeTypes],
  }
}

async function readCinemaCanvasFromRoot(cinemaRoot: string): Promise<CinemaCanvasDocument> {
  const canvasPath = path.join(cinemaRoot, CANVAS_FILE)

  let raw: string
  try {
    raw = await readFile(canvasPath, "utf8")
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new ApiError(
        404,
        "CINEMA_PROJECT_NOT_INITIALIZED",
        "This project has not been initialized for anybox for cinema yet.",
      )
    }
    throw error
  }

  try {
    return CinemaCanvasDocumentSchema.parse(normalizeCinemaCanvasInput(stripLegacyCustomNodesFromCanvasInput(JSON.parse(raw))))
  } catch (error) {
    throw createInvalidJsonError(CANVAS_FILE, error)
  }
}

async function writeCinemaCanvas(cinemaRoot: string, canvas: CinemaCanvasDocument): Promise<CinemaCanvasDocument> {
  const parsed = CinemaCanvasDocumentSchema.parse(normalizeCinemaCanvasInput(canvas))
  await mkdir(cinemaRoot, { recursive: true })

  const canvasPath = path.join(cinemaRoot, CANVAS_FILE)
  const tempPath = path.join(cinemaRoot, `${CANVAS_FILE}.${process.pid}.${Date.now()}.tmp`)
  await writeFile(tempPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8")
  await rename(tempPath, canvasPath)

  return parsed
}

function cinemaCanvasLockKey(cinemaRoot: string) {
  return `cinema-canvas:${cinemaRoot}`
}

async function mutateCinemaCanvasFromRoot(
  cinemaRoot: string,
  mutate: (current: CinemaCanvasDocument) => CinemaCanvasDocument | Promise<CinemaCanvasDocument>,
): Promise<CinemaCanvasDocument> {
  using _lock = await Lock.write(cinemaCanvasLockKey(cinemaRoot))
  const current = await readCinemaCanvasFromRoot(cinemaRoot)
  const next = await mutate(current)
  if (next === current) return current
  return await writeCinemaCanvas(cinemaRoot, {
    ...next,
    revision: (current.revision ?? 0) + 1,
  })
}

async function writeJsonAtomic(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true })
  const tempPath = path.join(path.dirname(filePath), `${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`)
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
  await rename(tempPath, filePath)
}

async function appendCinemaEvent(cinemaRoot: string, event: CinemaProjectEvent) {
  const parsed = CinemaProjectEventSchema.parse(event)
  await appendFile(path.join(cinemaRoot, EVENTS_FILE), `${JSON.stringify(parsed)}\n`, "utf8")
  return parsed
}

async function appendTaskAuditEvent(
  cinemaRoot: string,
  event: {
    time: string
    type: string
    actor: string
    taskID: string
    message: string
    data?: Record<string, unknown>
  },
) {
  await appendFile(path.join(cinemaRoot, TASKS_FILE), `${JSON.stringify(event)}\n`, "utf8")
  return event
}

function taskPath(cinemaRoot: string, taskID: string) {
  return path.join(cinemaRoot, TASKS_DIRECTORY, `${taskID}.json`)
}

async function writeGenerationTask(cinemaRoot: string, task: CinemaGenerationTask) {
  const parsed = CinemaGenerationTaskSchema.parse(task)
  await writeJsonAtomic(taskPath(cinemaRoot, task.id), parsed)
  return parsed
}

async function readGenerationTaskFromRoot(cinemaRoot: string, taskID: string): Promise<CinemaGenerationTask> {
  const raw = await readFile(taskPath(cinemaRoot, taskID), "utf8").catch((error: unknown) => {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new ApiError(404, "CINEMA_TASK_NOT_FOUND", `Cinema generation task '${taskID}' was not found.`)
    }
    throw error
  })

  try {
    return CinemaGenerationTaskSchema.parse(JSON.parse(raw))
  } catch (error) {
    throw createInvalidJsonError(`${TASKS_DIRECTORY}/${taskID}.json`, error)
  }
}

async function readGenerationTasksFromRoot(cinemaRoot: string): Promise<CinemaGenerationTask[]> {
  const entries = await readdir(path.join(cinemaRoot, TASKS_DIRECTORY), { withFileTypes: true }).catch((error: unknown) => {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return []
    throw error
  })
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))

  const tasks = await Promise.all(files.map(async (file) => {
    const taskID = file.slice(0, -".json".length)
    return await readGenerationTaskFromRoot(cinemaRoot, taskID)
  }))
  return tasks.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

function isFinalTaskStatus(status: CinemaGenerationTaskStatus) {
  return status === "succeeded" || status === "failed" || status === "canceled"
}

function makeTaskID() {
  return `task-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
}

function titleForGenerationTask(input: CreateCinemaGenerationTaskBody) {
  return input.title?.trim() || `Generation ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
}

function progressForTaskStatus(
  status: CinemaGenerationTaskStatus,
  updatedAt: string,
  message?: string | null,
): CinemaGenerationProgress {
  const base = {
    updatedAt,
    ...(message?.trim() ? { message: message.trim() } : {}),
  }
  switch (status) {
    case "queued":
      return { ...base, phase: "queued" }
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

function taskWithProgress(task: CinemaGenerationTask): CinemaGenerationTask {
  return {
    ...task,
    progress: task.progress ?? progressForTaskStatus(task.status, task.updatedAt, task.error),
  }
}

function textModelValue(input: { providerID: string; id: string }) {
  return `${input.providerID}/${input.id}`
}

function parseTextModelValue(value: string | null | undefined) {
  const trimmed = value?.trim()
  if (!trimmed) return null
  const [providerID, ...rest] = trimmed.split("/")
  const modelID = rest.join("/")
  if (!providerID || !modelID) return null
  return { providerID, modelID, value: trimmed }
}

function formatProviderLabel(providerID: string) {
  return providerID
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ") || providerID
}

function toCinemaTextModel(model: PublicModel): CinemaTextModel {
  return {
    value: textModelValue(model),
    providerID: model.providerID,
    modelID: model.id,
    label: model.name,
    providerLabel: model.providerName?.trim() || formatProviderLabel(model.providerID),
    available: model.available,
    supportsImageInput: model.capabilities.input.image,
  }
}

function toCinemaImageModel(model: PublicModel): CinemaImageModel {
  return {
    value: textModelValue(model),
    providerID: model.providerID,
    modelID: model.id,
    label: model.name,
    providerLabel: model.providerName?.trim() || formatProviderLabel(model.providerID),
    available: model.available,
    supportsImageInput: model.capabilities.input.image,
  }
}

type CinemaGenerationProvider = Awaited<ReturnType<typeof CinemaProviderRuntime.listCinemaVideoProviders>>[number]
type CinemaGenerationProviderModel = CinemaGenerationProvider["manifest"]["models"][number]

function cinemaProviderModelSupportsImageInput(model: CinemaGenerationProviderModel) {
  const modalities = model.modalities?.input.map((item) => item.trim().toLowerCase()) ?? []
  return modalities.includes("image") || model.modes.some((mode) => mode === "image-to-image" || mode === "image-edit")
}

function cinemaProviderInputCombinationParameters(
  model: CinemaGenerationProviderModel,
  mode: CreateCinemaGenerationTaskBody["mode"],
  parameters: Record<string, unknown>,
) {
  const combination = CinemaProviderRuntime.findCinemaVideoProviderInputCombinationForMode(
    model,
    mode,
    stringValue(parameters.inputCombinationMode),
  )
  const taskQueryEndpoint = combination?.endpoint?.taskQuery ?? model.taskQueryEndpoint
  return {
    ...(combination ? { inputCombinationMode: combination.mode } : {}),
    ...(combination?.endpoint ? { endpoint: combination.endpoint } : {}),
    ...(taskQueryEndpoint ? { taskQueryEndpoint } : {}),
  }
}

function toCinemaProviderImageModel(provider: CinemaGenerationProvider, model: CinemaGenerationProviderModel): CinemaImageModel {
  const modelID = CinemaProviderRuntime.cinemaVideoProviderModelSelectionID(model)
  const mode = cinemaProviderModelImageGenerationMode(provider, model)
  const formSpec = mode ? model.formSpecs.find((spec) => spec.mode === mode) : undefined
  return {
    value: textModelValue({ providerID: provider.manifest.id, id: modelID }),
    providerID: provider.manifest.id,
    modelID,
    offeringID: model.offeringID,
    providerModelID: CinemaProviderRuntime.cinemaVideoProviderTaskModelID(model),
    label: model.label,
    providerLabel: provider.manifest.name,
    available: true,
    supportsImageInput: cinemaProviderModelSupportsImageInput(model),
    ...(formSpec ? { formSpec } : {}),
  }
}

function isTextOutputModel(model: PublicModel) {
  return model.available && model.capabilities.output.text
}

function isImageOutputModel(model: PublicModel) {
  return model.available && model.capabilities.output.image
}

function providerModelOutputModalities(model: CinemaGenerationProviderModel) {
  return model.modalities?.output.map((item) => item.trim().toLowerCase()).filter(Boolean) ?? []
}

function providerModelOutputsImage(model: CinemaGenerationProviderModel) {
  const outputModalities = providerModelOutputModalities(model)
  if (outputModalities.length > 0) return outputModalities.includes("image")
  return model.modes.some((mode) => mode.endsWith("-image") || mode === "image-edit")
}

function providerModelOutputsVideo(model: CinemaGenerationProviderModel) {
  const outputModalities = providerModelOutputModalities(model)
  if (outputModalities.length > 0) return outputModalities.includes("video")
  return model.modes.some(isCinemaVideoGenerationMode) ||
    (model.inputCombinations ?? []).some((combination) => isCinemaVideoGenerationMode(combination.mode))
}

function cinemaProviderModelImageGenerationMode(
  provider: CinemaGenerationProvider,
  model: CinemaGenerationProviderModel,
): CinemaImageGenerationMode | null {
  return CINEMA_IMAGE_GENERATION_MODES.find((mode) =>
    model.modes.includes(mode) &&
    CinemaProviderRuntime.cinemaVideoProviderModelRuntimeSupportsMode(provider.manifest.id, model, mode)
  ) ?? null
}

function isAvailableCinemaProviderImageModel(provider: CinemaGenerationProvider, model: CinemaGenerationProviderModel) {
  return provider.auth.connected &&
    provider.runtime?.adapterAvailable === true &&
    cinemaProviderModelImageGenerationMode(provider, model) !== null &&
    providerModelOutputsImage(model)
}

function findCinemaTextModel(models: CinemaTextModel[], value: string | null | undefined) {
  const parsed = parseTextModelValue(value)
  if (!parsed) return null
  return models.find((model) => model.value === parsed.value) ?? null
}

function findCinemaImageModel(models: CinemaImageModel[], value: string | null | undefined) {
  const parsed = parseTextModelValue(value)
  if (!parsed) return null
  return models.find((model) => model.value === parsed.value) ?? null
}

function generationFormDefaultParameters(formSpec: GenerationFormSpec | undefined) {
  const parameters: Record<string, unknown> = {}
  if (!formSpec) return parameters

  for (const control of formSpec.controls) {
    if (!("defaultValue" in control)) continue
    if (control.defaultValue === undefined) continue
    parameters[control.key] = control.defaultValue
  }
  return parameters
}

function normalizeImagePrompt(prompt: string, style?: string) {
  const trimmedPrompt = prompt.trim()
  const trimmedStyle = style?.trim()
  return trimmedStyle ? `${trimmedPrompt}\n\nStyle: ${trimmedStyle}` : trimmedPrompt
}

function safeGeneratedImageNodeSegment(nodeID: string) {
  const readable = nodeID.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^_+|_+$/g, "").slice(0, 80)
  return readable || `node_${randomUUID().slice(0, 8)}`
}

function compactImageGenerationError(error: unknown) {
  const message = errorMessage(error)
  return message.length <= 500 ? message : `${message.slice(0, 497)}...`
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

function normalizeProjectDirectoryPath(relativePath: string | undefined) {
  const normalizedInput = (relativePath ?? "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")
  if (!normalizedInput) return ""
  if (normalizedInput.includes("\0") || path.isAbsolute(relativePath ?? "") || normalizedInput.split("/").includes("..")) {
    throw new ApiError(400, "CINEMA_DIRECTORY_PATH_INVALID", "Directory path must be project-relative.")
  }
  return normalizedInput
}

function resolveProjectRelativeDirectory(root: string, relativePath: string | undefined) {
  const normalizedInput = normalizeProjectDirectoryPath(relativePath)
  const resolvedRoot = path.resolve(root)
  const resolvedPath = path.resolve(root, normalizedInput)
  const relative = path.relative(resolvedRoot, resolvedPath)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ApiError(400, "CINEMA_DIRECTORY_PATH_INVALID", "Directory path must stay inside the current project.")
  }
  return {
    relativePath: normalizedInput,
    resolvedPath,
  }
}

function parentProjectDirectoryPath(relativePath: string) {
  if (!relativePath) return null
  const parent = path.posix.dirname(relativePath)
  return parent === "." ? "" : parent
}

function shouldSkipProjectDirectoryEntry(name: string) {
  return name.startsWith(".") || PROJECT_DIRECTORY_SKIPPED_NAMES.has(name)
}

function imageExtensionForMime(mime: string) {
  return IMAGE_EXTENSION_BY_MIME[mime.toLowerCase()] ?? null
}

function imageMimeForPath(filePath: string) {
  return IMAGE_MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()] ?? null
}

function projectAssetMimeForPath(filePath: string) {
  const extension = path.extname(filePath).toLowerCase()
  return IMAGE_MIME_BY_EXTENSION[extension] ?? VIDEO_MIME_BY_EXTENSION[extension] ?? null
}

function isSupportedPreviewAssetMime(mimeType: string) {
  return isSupportedImageMime(mimeType) || Object.values(VIDEO_MIME_BY_EXTENSION).includes(mimeType)
}

function previewAssetMaxBytesForMime(mimeType: string) {
  return mimeType.startsWith("video/") ? CINEMA_PROJECT_VIDEO_ASSET_MAX_BYTES : CINEMA_PROJECT_IMAGE_ASSET_MAX_BYTES
}

function safeImportedImageBaseName(fileName: string) {
  const extension = path.extname(fileName)
  const base = path.basename(fileName, extension)
  return base
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72)
    || "image"
}

function parseCinemaProjectAssetRange(rangeHeader: string | null | undefined, sizeBytes: number): CinemaProjectAssetRange | null {
  const header = rangeHeader?.trim()
  if (!header) return null

  const match = /^bytes=(\d*)-(\d*)$/.exec(header)
  if (!match) {
    throw new ApiError(416, "CINEMA_ASSET_RANGE_NOT_SATISFIABLE", "Only a single byte range is supported.")
  }

  const [, startText, endText] = match
  if (!startText && !endText) {
    throw new ApiError(416, "CINEMA_ASSET_RANGE_NOT_SATISFIABLE", "Requested byte range is empty.")
  }
  if (sizeBytes <= 0) {
    throw new ApiError(416, "CINEMA_ASSET_RANGE_NOT_SATISFIABLE", "Requested byte range cannot be served for an empty asset.")
  }

  if (!startText) {
    const suffixLength = Number(endText)
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      throw new ApiError(416, "CINEMA_ASSET_RANGE_NOT_SATISFIABLE", "Requested suffix byte range is invalid.")
    }
    const start = Math.max(sizeBytes - suffixLength, 0)
    return {
      start,
      end: sizeBytes - 1,
      total: sizeBytes,
    }
  }

  const start = Number(startText)
  const requestedEnd = endText ? Number(endText) : sizeBytes - 1
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(requestedEnd) ||
    start < 0 ||
    requestedEnd < start ||
    start >= sizeBytes
  ) {
    throw new ApiError(416, "CINEMA_ASSET_RANGE_NOT_SATISFIABLE", "Requested byte range is outside the asset.")
  }

  return {
    start,
    end: Math.min(requestedEnd, sizeBytes - 1),
    total: sizeBytes,
  }
}

const CINEMA_TEXT_GENERATION_SYSTEM_PROMPT = [
  "You are helping write text for an AI film project.",
  "Follow the user's generation request.",
  "Use the existing node text only as context.",
  "Return only the generated text, with no explanations or commentary.",
].join("\n")

function buildCinemaTextGenerationPrompt(input: {
  currentText: string
  prompt: string
}) {
  return [
    "Existing text:",
    input.currentText.trim() || "(empty)",
    "",
    "Generation request:",
    input.prompt.trim(),
  ].join("\n")
}

function appendGeneratedText(currentText: string, generatedText: string) {
  const trimmedGenerated = generatedText.trim()
  const trimmedCurrent = currentText.trim()
  if (!trimmedCurrent) return trimmedGenerated
  return `${trimmedCurrent}\n\n${trimmedGenerated}`
}

async function readCinemaTextGenerationSourceImage(root: string, sourceImagePath: string) {
  return await readCinemaSourceImage(root, sourceImagePath, {
    unsupportedCode: "CINEMA_TEXT_SOURCE_IMAGE_UNSUPPORTED",
    notFoundCode: "CINEMA_TEXT_SOURCE_IMAGE_NOT_FOUND",
    tooLargeCode: "CINEMA_TEXT_SOURCE_IMAGE_TOO_LARGE",
    unsupportedMessage: "Text generation source image must be a supported project image asset.",
    notFoundMessage: "Text generation source image was not found.",
    notFileMessage: "Text generation source image must be a file.",
    tooLargeMessage: "Text generation source image is too large.",
  })
}

async function readCinemaImageGenerationSourceImage(root: string, sourceImagePath: string) {
  return await readCinemaSourceImage(root, sourceImagePath, {
    unsupportedCode: "CINEMA_IMAGE_SOURCE_IMAGE_UNSUPPORTED",
    notFoundCode: "CINEMA_IMAGE_SOURCE_IMAGE_NOT_FOUND",
    tooLargeCode: "CINEMA_IMAGE_SOURCE_IMAGE_TOO_LARGE",
    unsupportedMessage: "Image generation source image must be a supported project image asset.",
    notFoundMessage: "Image generation source image was not found.",
    notFileMessage: "Image generation source image must be a file.",
    tooLargeMessage: "Image generation source image is too large.",
  })
}

async function readCinemaSourceImage(root: string, sourceImagePath: string, messages: {
  unsupportedCode: string
  notFoundCode: string
  tooLargeCode: string
  unsupportedMessage: string
  notFoundMessage: string
  notFileMessage: string
  tooLargeMessage: string
}) {
  const filePath = resolveProjectRelativeFile(root, sourceImagePath)
  const mimeType = imageMimeForPath(filePath)
  if (!mimeType || !isSupportedImageMime(mimeType)) {
    throw new ApiError(415, messages.unsupportedCode, messages.unsupportedMessage)
  }

  const fileStat = await stat(filePath).catch((error: unknown) => {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new ApiError(404, messages.notFoundCode, messages.notFoundMessage)
    }
    throw error
  })
  if (!fileStat.isFile()) {
    throw new ApiError(415, messages.unsupportedCode, messages.notFileMessage)
  }
  if (fileStat.size > CINEMA_PROJECT_IMAGE_ASSET_MAX_BYTES) {
    throw new ApiError(413, messages.tooLargeCode, messages.tooLargeMessage)
  }

  return {
    data: await readFile(filePath),
    mediaType: mimeType,
    path: projectRelativePath(root, filePath),
  }
}

function uniqueNonEmptyStrings(values: Array<string | undefined>) {
  const result: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const item = value?.trim()
    if (!item || seen.has(item)) continue
    seen.add(item)
    result.push(item)
  }
  return result
}

function redactSensitiveErrorText(value: string) {
  return value
    .replace(/("?(?:authorization)"?\s*[:=]\s*)Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "$1Bearer [redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(sk|ak|pk)-[A-Za-z0-9._-]{8,}\b/g, "$1-[redacted]")
    .replace(/("?(?:api[_-]?key|access[_-]?token|secret|cookie)"?\s*[:=]\s*)("[^"]+"|[^\s,}]+)/gi, "$1[redacted]")
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? error.cause.message : ""
    const message = error.message && error.message !== error.name ? error.message : cause
    return redactSensitiveErrorText(message || error.name)
  }
  return redactSensitiveErrorText(String(error))
}

function customApiCredentialProviderIDFor(node: CinemaCanvasNode) {
  const auth = isRecord(node.data?.auth) ? node.data.auth : {}
  return stringValue(auth.credentialProviderID) ?? `cinema-custom-api-${node.id}`
}

function isCustomApiRuntimeNode(node: CinemaCanvasNode) {
  return node.type === "custom-api"
}

async function customApiAuthStateFor(node: CinemaCanvasNode): Promise<CinemaCustomApiAuthState> {
  const credentialProviderID = customApiCredentialProviderIDFor(node)
  const runtimeAuth = await ProviderAuth.resolveProviderRuntimeAuth(credentialProviderID, {}, {
    method: "api-key",
  })
  const connected = Boolean(runtimeAuth.apiKey)
  return {
    nodeID: node.id,
    credentialProviderID,
    connected,
    status: connected ? "connected" : "not_connected",
  }
}

function sanitizeHeaders(headers: Record<string, string>) {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    result[key] = /authorization|api[-_]?key|token|secret|cookie/i.test(key)
      ? redactSensitiveErrorText(value)
      : value
  }
  return result
}

function validateCustomApiURL(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new ApiError(400, "CINEMA_CUSTOM_API_URL_INVALID", "Custom API URL must be a valid absolute http(s) URL.")
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ApiError(400, "CINEMA_CUSTOM_API_URL_INVALID", "Custom API URL must use http or https.")
  }
  if (url.username || url.password) {
    throw new ApiError(400, "CINEMA_CUSTOM_API_URL_INVALID", "Custom API URL must not contain embedded credentials.")
  }

  const hostname = url.hostname.toLowerCase()
  if (
    hostname === "169.254.169.254" ||
    hostname.startsWith("169.254.") ||
    hostname === "metadata.google.internal" ||
    hostname === "metadata"
  ) {
    throw new ApiError(400, "CINEMA_CUSTOM_API_URL_FORBIDDEN", "Custom API URL points to a blocked metadata host.")
  }

  return url.toString()
}

function normalizeCustomApiTimeout(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return CINEMA_CUSTOM_API_DEFAULT_TIMEOUT_MS
  return Math.min(CINEMA_CUSTOM_API_MAX_TIMEOUT_MS, Math.max(1, Math.round(value)))
}

function customApiMissingConfigError(field: string) {
  return new ApiError(400, "CINEMA_CUSTOM_API_CONFIG_INVALID", `Custom API node is missing a valid ${field}.`)
}

function getObjectField(value: unknown, field: string) {
  if (!isRecord(value)) throw customApiMissingConfigError(field)
  return value
}

function readCustomApiNodeConfig(node: CinemaCanvasNode) {
  const data = node.data ?? {}
  const request = getObjectField(data.request, "request")
  const auth = isRecord(data.auth) ? data.auth : {}
  const outputMapping = isRecord(data.outputMapping) ? data.outputMapping : {}
  const headersTemplateValue = request.headersTemplate
  const headersTemplate: Record<string, string> = {}
  if (isRecord(headersTemplateValue)) {
    for (const [key, value] of Object.entries(headersTemplateValue)) {
      if (typeof value === "string") headersTemplate[key] = value
    }
  }

  const method = typeof request.method === "string" ? request.method.trim().toUpperCase() : "POST"
  if (method !== "POST") {
    throw new ApiError(400, "CINEMA_CUSTOM_API_METHOD_UNSUPPORTED", "Custom API V1 only supports POST requests.")
  }

  const url = stringValue(request.url)
  if (!url) throw customApiMissingConfigError("request.url")

  const authType = typeof auth.type === "string" ? auth.type.trim() : "none"
  if (authType !== "none" && authType !== "bearer" && authType !== "api-key-header") {
    throw new ApiError(400, "CINEMA_CUSTOM_API_AUTH_UNSUPPORTED", "Custom API auth type is not supported.")
  }

  return {
    inputValues: isRecord(data.inputValues) ? data.inputValues : {},
    request: {
      method: "POST" as const,
      url,
      headersTemplate,
      bodyTemplate: "bodyTemplate" in request ? request.bodyTemplate : {},
      timeoutMs: normalizeCustomApiTimeout(request.timeoutMs),
    },
    auth: {
      type: authType as "none" | "bearer" | "api-key-header",
      credentialProviderID: stringValue(auth.credentialProviderID) ?? customApiCredentialProviderIDFor(node),
      headerName: stringValue(auth.headerName),
    },
    outputMapping: {
      text: stringValue(outputMapping.text),
      json: stringValue(outputMapping.json),
      imageUrl: stringValue(outputMapping.imageUrl),
    },
  }
}

function customApiNodeText(node: CinemaCanvasNode) {
  const data = node.data ?? {}
  const candidates = [
    data.outputText,
    data.text,
    data.prompt,
  ]
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim()
  }
  return ""
}

function buildCustomApiTemplateContext(input: {
  projectID: string
  runID: string
  node: CinemaCanvasNode
  canvas: CinemaCanvasDocument
  inputValues: Record<string, unknown>
}) {
  const upstreamItems = input.canvas.edges
    .filter((edge) => edge.target === input.node.id)
    .flatMap((edge) => {
      const source = input.canvas.nodes.find((node) => node.id === edge.source)
      if (!source) return []
      const data = source.data ?? {}
      const item = {
        nodeID: source.id,
        nodeTitle: source.title,
        type: source.type,
        text: customApiNodeText(source),
        outputText: typeof data.outputText === "string" ? data.outputText : undefined,
        outputJson: data.outputJson,
        outputImageUrl: typeof data.outputImageUrl === "string" ? data.outputImageUrl : undefined,
      }
      return [item]
    })

  return {
    inputs: input.inputValues,
    upstream: {
      text: upstreamItems.map((item) => item.text).filter(Boolean).join("\n\n"),
      items: upstreamItems,
    },
    node: {
      id: input.node.id,
      title: input.node.title,
    },
    system: {
      projectID: input.projectID,
      runID: input.runID,
    },
  }
}

function readPathValue(root: unknown, pathExpression: string) {
  const segments = pathExpression.split(".").filter(Boolean)
  let current = root
  for (const segment of segments) {
    if (!isRecord(current) && !Array.isArray(current)) return undefined
    if (Array.isArray(current)) {
      const index = Number(segment)
      if (!Number.isInteger(index) || index < 0) return undefined
      current = current[index]
    } else {
      current = current[segment]
    }
  }
  return current
}

function formatTemplateValue(value: unknown) {
  if (value === null || value === undefined) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value)
  return JSON.stringify(value)
}

function renderCustomApiTemplate(value: unknown, context: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    const exact = /^\s*\{\{\s*([A-Za-z0-9_.]+)\s*\}\}\s*$/.exec(value)
    if (exact) {
      const resolved = readPathValue(context, exact[1]!)
      if (resolved === undefined) {
        throw new ApiError(400, "CINEMA_CUSTOM_API_TEMPLATE_MISSING", `Template variable '${exact[1]}' was not found.`)
      }
      return resolved
    }

    return value.replace(/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g, (_match, key: string) => {
      const resolved = readPathValue(context, key)
      if (resolved === undefined) {
        throw new ApiError(400, "CINEMA_CUSTOM_API_TEMPLATE_MISSING", `Template variable '${key}' was not found.`)
      }
      return formatTemplateValue(resolved)
    })
  }

  if (Array.isArray(value)) {
    return value.map((item) => renderCustomApiTemplate(item, context))
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, renderCustomApiTemplate(item, context)])
    )
  }

  return value
}

function parseJsonPath(pathExpression: string) {
  const pathValue = pathExpression.trim()
  if (pathValue === "$") return [] as Array<string | number>
  if (!pathValue.startsWith("$")) {
    throw new ApiError(400, "CINEMA_CUSTOM_API_JSONPATH_INVALID", `Output mapping '${pathExpression}' must start with $.`)
  }

  const segments: Array<string | number> = []
  let index = 1
  while (index < pathValue.length) {
    const char = pathValue[index]
    if (char === ".") {
      index += 1
      const start = index
      while (index < pathValue.length && pathValue[index] !== "." && pathValue[index] !== "[") index += 1
      const segment = pathValue.slice(start, index)
      if (!segment) throw new ApiError(400, "CINEMA_CUSTOM_API_JSONPATH_INVALID", `Output mapping '${pathExpression}' is invalid.`)
      segments.push(segment)
      continue
    }

    if (char === "[") {
      const end = pathValue.indexOf("]", index)
      if (end < 0) throw new ApiError(400, "CINEMA_CUSTOM_API_JSONPATH_INVALID", `Output mapping '${pathExpression}' is invalid.`)
      const raw = pathValue.slice(index + 1, end).trim()
      if (/^\d+$/.test(raw)) {
        segments.push(Number(raw))
      } else {
        const quoted = /^["'](.+)["']$/.exec(raw)
        if (!quoted) throw new ApiError(400, "CINEMA_CUSTOM_API_JSONPATH_INVALID", `Output mapping '${pathExpression}' is invalid.`)
        segments.push(quoted[1]!)
      }
      index = end + 1
      continue
    }

    throw new ApiError(400, "CINEMA_CUSTOM_API_JSONPATH_INVALID", `Output mapping '${pathExpression}' is invalid.`)
  }

  return segments
}

function readJsonPathValue(root: unknown, pathExpression: string) {
  let current = root
  for (const segment of parseJsonPath(pathExpression)) {
    if (typeof segment === "number") {
      if (!Array.isArray(current)) return undefined
      current = current[segment]
    } else {
      if (!isRecord(current)) return undefined
      current = current[segment]
    }
  }
  return current
}

function mapCustomApiResponse(responseJson: unknown, mapping: { text?: string; json?: string; imageUrl?: string }): CinemaCustomApiOutput {
  const output: CinemaCustomApiOutput = {}
  if (mapping.text) {
    const value = readJsonPathValue(responseJson, mapping.text)
    if (value !== undefined) output.text = typeof value === "string" ? value : JSON.stringify(value)
  }
  if (mapping.json) {
    const value = readJsonPathValue(responseJson, mapping.json)
    if (value !== undefined) output.json = value
  }
  if (mapping.imageUrl) {
    const value = readJsonPathValue(responseJson, mapping.imageUrl)
    if (value !== undefined) output.imageUrl = typeof value === "string" ? value : String(value)
  }
  return output
}

async function readResponseTextWithLimit(response: Response) {
  if (!response.body) return ""
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    if (total > CINEMA_CUSTOM_API_MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined)
      throw new ApiError(413, "CINEMA_CUSTOM_API_RESPONSE_TOO_LARGE", "Custom API response body is too large.")
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

async function executeCustomApiJsonRequest(input: {
  url: string
  headers: Record<string, string>
  body: unknown
  timeoutMs: number
}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs)
  const startedAt = Date.now()
  try {
    const response = await fetch(input.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...input.headers,
      },
      body: JSON.stringify(input.body),
      signal: controller.signal,
      redirect: "follow",
    })
    const text = await readResponseTextWithLimit(response)
    let responseJson: unknown
    try {
      responseJson = text ? JSON.parse(text) : null
    } catch {
      throw new ApiError(502, "CINEMA_CUSTOM_API_RESPONSE_INVALID_JSON", "Custom API response must be valid JSON.")
    }
    if (!response.ok) {
      throw new ApiError(
        502,
        "CINEMA_CUSTOM_API_HTTP_ERROR",
        `Custom API request failed with HTTP ${response.status}.`,
      )
    }
    return {
      statusCode: response.status,
      responseJson,
      elapsedMs: Date.now() - startedAt,
    }
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiError(504, "CINEMA_CUSTOM_API_TIMEOUT", "Custom API request timed out.")
    }
    throw new ApiError(502, "CINEMA_CUSTOM_API_REQUEST_FAILED", `Custom API request failed: ${errorMessage(error)}`)
  } finally {
    clearTimeout(timeout)
  }
}

function writeCustomApiNodeResult(input: {
  canvas: CinemaCanvasDocument
  nodeID: string
  inputValues: Record<string, unknown>
  output?: CinemaCustomApiOutput
  statusCode?: number
  status: "succeeded" | "failed"
  error?: string | null
}) {
  const timestamp = nowISO()
  return withNodeTypes({
    ...input.canvas,
    nodes: input.canvas.nodes.map((node) =>
      node.id === input.nodeID
        ? {
          ...node,
          data: {
            ...node.data,
            inputValues: input.inputValues,
            status: input.status,
            outputText: input.output?.text,
            outputJson: input.output?.json,
            outputImageUrl: input.output?.imageUrl,
            lastRunAt: timestamp,
            ...(input.statusCode ? { lastStatusCode: input.statusCode } : {}),
            error: input.error ?? null,
          },
        }
        : node
    ),
  })
}

async function writeCustomApiNodeFailure(input: {
  cinemaRoot: string
  nodeID: string
  inputValues: Record<string, unknown>
  error: string
  statusCode?: number
}) {
  await mutateCinemaCanvasFromRoot(input.cinemaRoot, (canvas) => writeCustomApiNodeResult({
    canvas,
    nodeID: input.nodeID,
    inputValues: input.inputValues,
    status: "failed",
    error: input.error,
    statusCode: input.statusCode,
  }))
}

function createCinemaTextGenerationRuntimeError(error: unknown, modelValue: string) {
  if (InitError.isInstance(error)) {
    const detail = errorMessage(error)
    return new ApiError(
      400,
      "CINEMA_TEXT_PROVIDER_NOT_CONFIGURED",
      detail && detail !== error.name
        ? `Text model provider is not ready for '${modelValue}': ${detail}`
        : `Text model provider is not ready for '${modelValue}'. Configure the provider credential and try again.`,
    )
  }

  const detail = errorMessage(error)
  return new ApiError(
    502,
    "CINEMA_TEXT_GENERATION_FAILED",
    detail
      ? `Text generation failed for '${modelValue}': ${detail}`
      : `Text generation failed for '${modelValue}'.`,
  )
}

function createCinemaImageGenerationRuntimeError(error: unknown, modelValue: string) {
  if (InitError.isInstance(error)) {
    const detail = errorMessage(error)
    return new ApiError(
      400,
      "CINEMA_IMAGE_PROVIDER_NOT_CONFIGURED",
      detail && detail !== error.name
        ? `Image model provider is not ready for '${modelValue}': ${detail}`
        : `Image model provider is not ready for '${modelValue}'. Configure the provider credential and try again.`,
    )
  }

  const detail = errorMessage(error)
  return new ApiError(
    502,
    "CINEMA_IMAGE_GENERATION_FAILED",
    detail
      ? `Image generation failed for '${modelValue}': ${detail}`
      : `Image generation failed for '${modelValue}'.`,
  )
}

function assertCanvasHasNode(canvas: CinemaCanvasDocument, nodeID: string) {
  if (!canvas.nodes.some((node) => node.id === nodeID)) {
    throw new ApiError(404, "CINEMA_NODE_NOT_FOUND", `Cinema node '${nodeID}' was not found.`)
  }
}

function isActiveCinemaImageNodeData(data: Record<string, unknown> | undefined) {
  const status = stringValue(data?.status)?.toLowerCase()
  const progress = isRecord(data?.progress) ? data.progress : undefined
  const progressPhase = stringValue(progress?.phase)?.toLowerCase()
  return status === "queued" || status === "running" || progressPhase === "queued" || progressPhase === "running"
}

function cinemaImageNodeHasContent(data: Record<string, unknown> | undefined) {
  return Boolean(parseCinemaImageNodeAsset(data?.asset)) || parseCinemaImageNodeAssets(data?.candidateAssets).length > 0
}

function assertImageNodeAcceptsGeneration(node: CinemaCanvasNode) {
  if (node.type !== "image") return
  if (cinemaImageNodeHasContent(node.data)) {
    throw new ApiError(
      409,
      "CINEMA_IMAGE_NODE_FINALIZED",
      `Cinema image node '${node.id}' already contains image content. Create a new image node to generate another image.`,
    )
  }
  if (isActiveCinemaImageNodeData(node.data)) {
    throw new ApiError(
      409,
      "CINEMA_IMAGE_NODE_ACTIVE",
      `Cinema image node '${node.id}' already has an active generation task.`,
    )
  }
}

function withNodeTypes(canvas: CinemaCanvasDocument) {
  const nodeTypes = new Set<CinemaNodeType>(canvas.nodeTypes)
  for (const node of canvas.nodes) nodeTypes.add(node.type)
  return {
    ...canvas,
    nodeTypes: [...nodeTypes],
  }
}

function appendNode(canvas: CinemaCanvasDocument, node: CinemaCanvasNode) {
  if (canvas.nodes.some((current) => current.id === node.id)) {
    throw new ApiError(409, "CINEMA_COMMAND_INVALID", `Cinema node '${node.id}' already exists.`)
  }

  return withNodeTypes({
    ...canvas,
    nodes: [...canvas.nodes, node],
  })
}

function describeCinemaCommand(command: CinemaCommand) {
  switch (command.type) {
    case "create-node":
      return `Created ${command.node.type} node '${command.node.title}'.`
    case "create-node-from-asset":
      return `Created Cinema node '${command.nodeID}' from asset '${command.assetRef.assetID}'.`
    case "relink-node-asset":
      return `Relinked Cinema node '${command.nodeID}' to asset '${command.assetRef.assetID}'.`
    case "update-node":
      return `Updated Cinema node '${command.nodeID}'.`
    case "delete-node":
      return `Deleted Cinema node '${command.nodeID}'.`
    case "connect-nodes":
      return `Connected '${command.edge.source}' to '${command.edge.target}'.`
    case "disconnect-edge":
      return `Disconnected Cinema edge '${command.edgeID}'.`
    case "update-viewport":
      return "Updated Cinema canvas viewport."
    case "create-generation-task":
      return `Created generation task '${command.node.title}'.`
    case "complete-generation-task":
      return `Completed generation task '${command.taskNodeID}'.`
  }
}

function applyCommandToCanvas(canvas: CinemaCanvasDocument, command: CinemaCommand): CinemaCanvasDocument {
  switch (command.type) {
    case "create-node":
      if (command.node.data?.assetRef !== undefined) {
        throw new ApiError(
          409,
          "CINEMA_ASSET_REF_SERVER_REQUIRED",
          "Use create-node-from-asset so the server can resolve the canonical asset reference.",
        )
      }
      return appendNode(canvas, command.node)
    case "create-node-from-asset":
    case "relink-node-asset":
      throw new ApiError(
        500,
        "CINEMA_COMMAND_DISPATCH_INVALID",
        "Asset node commands must be resolved before applying the synchronous Canvas command.",
      )
    case "update-node": {
      assertCanvasHasNode(canvas, command.nodeID)
      const currentNode = canvas.nodes.find((node) => node.id === command.nodeID)!
      const currentAssetRef = currentNode.data?.assetRef
      const patchedAssetRef = command.patch.data?.assetRef
      if (
        command.patch.data
        && (currentAssetRef !== undefined || patchedAssetRef !== undefined)
        && JSON.stringify(currentAssetRef) !== JSON.stringify(patchedAssetRef)
      ) {
        throw new ApiError(
          409,
          "CINEMA_ASSET_REF_IMMUTABLE",
          "Use the relink-node-asset command to change a node's asset reference.",
        )
      }
      if (currentAssetRef !== undefined && command.patch.type && command.patch.type !== currentNode.type) {
        throw new ApiError(
          409,
          "CINEMA_ASSET_KIND_MISMATCH",
          "An asset-backed node cannot change media kind through update-node.",
        )
      }
      return withNodeTypes({
        ...canvas,
        nodes: canvas.nodes.map((node) =>
          node.id === command.nodeID
            ? {
              ...node,
              ...command.patch,
              data: command.patch.data ?? node.data,
            }
            : node
        ),
      })
    }
    case "delete-node": {
      assertCanvasHasNode(canvas, command.nodeID)
      return {
        ...canvas,
        nodes: canvas.nodes.filter((node) => node.id !== command.nodeID),
        edges: canvas.edges.filter((edge) => edge.source !== command.nodeID && edge.target !== command.nodeID),
      }
    }
    case "connect-nodes": {
      assertCanvasHasNode(canvas, command.edge.source)
      assertCanvasHasNode(canvas, command.edge.target)
      if (canvas.edges.some((edge) => edge.id === command.edge.id)) {
        throw new ApiError(409, "CINEMA_COMMAND_INVALID", `Cinema edge '${command.edge.id}' already exists.`)
      }
      return {
        ...canvas,
        edges: [...canvas.edges, command.edge],
      }
    }
    case "disconnect-edge": {
      return {
        ...canvas,
        edges: canvas.edges.filter((edge) => edge.id !== command.edgeID),
      }
    }
    case "update-viewport":
      return {
        ...canvas,
        viewport: command.viewport,
      }
    case "create-generation-task":
      return appendNode(canvas, {
        ...command.node,
        data: {
          status: "queued",
          ...command.node.data,
        },
      })
    case "complete-generation-task": {
      const taskNode = canvas.nodes.find((node) => node.id === command.taskNodeID)
      if (!taskNode) {
        throw new ApiError(404, "CINEMA_NODE_NOT_FOUND", `Cinema node '${command.taskNodeID}' was not found.`)
      }
      if (taskNode.type !== "generation-task") {
        throw new ApiError(409, "CINEMA_COMMAND_INVALID", `Cinema node '${command.taskNodeID}' is not a generation task.`)
      }

      let next = withNodeTypes({
        ...canvas,
        nodes: canvas.nodes.map((node) =>
          node.id === command.taskNodeID
            ? {
              ...node,
              data: {
                ...node.data,
                status: "completed",
              },
            }
            : node
        ),
      })

      if (command.outputNode) {
        next = appendNode(next, command.outputNode)
        const edgeID = `edge-${command.taskNodeID}-${command.outputNode.id}`
        if (!next.edges.some((edge) => edge.id === edgeID)) {
          next = {
            ...next,
            edges: [
              ...next.edges,
              {
                id: edgeID,
                source: command.taskNodeID,
                target: command.outputNode.id,
              },
            ],
          }
        }
      }

      return next
    }
  }
}

async function readCinemaEventsFromRoot(
  cinemaRoot: string,
  options: { after?: number; limit?: number } = {},
): Promise<CinemaEventsResult> {
  const raw = await readFile(path.join(cinemaRoot, EVENTS_FILE), "utf8").catch((error: unknown) => {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return ""
    throw error
  })
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0)
  const limit = options.limit ?? 50
  const start = options.after ?? Math.max(0, lines.length - limit)
  const selected = lines.slice(start, start + limit)

  try {
    return {
      events: selected.map((line) => CinemaProjectEventSchema.parse(JSON.parse(line))),
      nextCursor: start + selected.length,
    }
  } catch (error) {
    throw createInvalidJsonError(EVENTS_FILE, error)
  }
}

async function summarizeProjectDirectory(root: string, directory: string) {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true }).catch((error: unknown) => {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null
    throw error
  })

  if (!entries) {
    return {
      path: directory,
      exists: false,
      fileCount: 0,
      sample: [],
    }
  }

  const names = entries
    .filter((entry) => !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))

  return {
    path: directory,
    exists: true,
    fileCount: names.length,
    sample: names.slice(0, 8),
  }
}

async function hasConfiguredProvider(cinemaRoot: string) {
  const providers = await readOptionalJson(path.join(cinemaRoot, PROVIDERS_FILE)).catch((error) => {
    throw createInvalidJsonError(PROVIDERS_FILE, error)
  })
  if (Array.isArray(providers?.providers) && providers.providers.length > 0) return true
  return await CinemaProviderRuntime.hasConnectedCinemaVideoProvider()
}

function summarizeNodeData(node: CinemaCanvasNode) {
  const text = typeof node.data?.text === "string" && node.data.text.trim()
    ? node.data.text.trim()
    : undefined
  const status = typeof node.data?.status === "string" && node.data.status.trim()
    ? node.data.status.trim()
    : undefined
  return {
    id: node.id,
    type: node.type,
    title: node.title,
    ...(text ? { text } : {}),
    ...(status ? { status } : {}),
  }
}

function findProjectGaps(canvas: CinemaCanvasDocument, providerConfigured: boolean) {
  const types = new Set(canvas.nodes.map((node) => node.type))
  const hasGenerationTask = types.has("generation-task") || canvas.nodes.some((node) =>
    node.type === "video" && typeof node.data?.taskID === "string" && node.data.taskID.trim().length > 0
  )
  const gaps: string[] = []
  if (!types.has("shot")) gaps.push("no-shot-nodes")
  if (!types.has("prompt")) gaps.push("no-prompt-nodes")
  if (!hasGenerationTask) gaps.push("no-generation-tasks")
  if (!providerConfigured) gaps.push("no-provider-configured")
  return gaps
}

function taskNodeDataFor(task: CinemaGenerationTask) {
  const progress = task.progress ?? progressForTaskStatus(task.status, task.updatedAt, task.error)
  return {
    text: task.input.prompt,
    taskID: task.id,
    providerID: task.providerID,
    modelID: task.modelID,
    mode: task.mode,
    status: task.status,
    progress,
    sourceNodeIDs: task.input.sourceNodeIDs,
    parameters: task.input.parameters,
    outputAssets: task.outputAssets,
    error: task.error ?? null,
  }
}

function imageTaskNodeDataFor(task: CinemaGenerationTask, currentData: Record<string, unknown> | undefined) {
  const imageAssets = task.outputAssets.filter((asset) => asset.kind === "image")
  const parameters = task.input.parameters
  const progress = task.progress ?? progressForTaskStatus(task.status, task.updatedAt, task.error)
  const nodePrompt = typeof parameters.userPrompt === "string" ? parameters.userPrompt : task.input.prompt
  const nextData: Record<string, unknown> = {
    ...currentData,
    prompt: nodePrompt,
    taskID: task.id,
    providerID: task.providerID,
    modelID: task.modelID,
    model: textModelValue({ providerID: task.providerID, id: task.modelID }),
    mode: task.mode,
    status: task.status,
    progress,
    error: task.error ?? null,
  }

  if (typeof parameters.size === "string") nextData.size = parameters.size
  if (typeof parameters.count === "number" && Number.isFinite(parameters.count)) nextData.count = parameters.count
  if (typeof parameters.style === "string") nextData.style = parameters.style
  if (Array.isArray(task.input.sourceNodeIDs)) nextData.sourceNodeIDs = task.input.sourceNodeIDs
  if (Array.isArray(parameters.sourceTextPrompts)) {
    nextData.sourceTextPrompts = parameters.sourceTextPrompts.filter((item): item is string => typeof item === "string")
  }
  if (typeof parameters.sourceImageAssetID === "string") nextData.sourceImageAssetID = parameters.sourceImageAssetID
  if (Array.isArray(parameters.sourceImageAssetIDs)) {
    nextData.sourceImageAssetIDs = parameters.sourceImageAssetIDs.filter((item): item is string => typeof item === "string")
  }
  if (typeof parameters.sourceImagePath === "string") nextData.sourceImagePath = parameters.sourceImagePath
  if (Array.isArray(parameters.sourceImagePaths)) {
    nextData.sourceImagePaths = parameters.sourceImagePaths.filter((item): item is string => typeof item === "string")
  }

  delete nextData.resultAssets
  delete nextData.selectedAssetID

  if (imageAssets.length === 1) {
    nextData.asset = imageAssets[0]
    delete nextData.candidateAssets
    delete nextData.selectedCandidateAssetID
    nextData.sourceKind = "generation"
    nextData.generatedAt = task.updatedAt
  } else if (imageAssets.length > 1) {
    delete nextData.asset
    nextData.candidateAssets = imageAssets
    nextData.selectedCandidateAssetID = imageAssets[0]!.id
    nextData.sourceKind = "generation"
    nextData.generatedAt = task.updatedAt
  }

  return nextData
}

function taskNodeFor(
  task: CinemaGenerationTask,
  position = { x: 240, y: 220 },
  type: "generation-task" | "video" = "generation-task",
  size = type === "video" ? { width: 520, height: 430 } : { width: 390, height: 240 },
): CinemaCanvasNode {
  return {
    id: task.taskNodeID ?? `node-generation-task-${task.id}`,
    type,
    title: task.title,
    position,
    size,
    data: taskNodeDataFor(task),
  }
}

function outputNodeFor(task: CinemaGenerationTask): CinemaCanvasNode | null {
  const asset = task.outputAssets[0]
  if (!asset) return null
  return {
    id: task.outputNodeID ?? `node-video-${task.id}`,
    type: asset.kind === "audio" ? "audio" : asset.kind === "image" ? "image" : "video",
    title: `${task.title} Result`,
    position: { x: 720, y: 240 },
    size: { width: 360, height: 220 },
    data: {
      text: asset.path,
      taskID: task.id,
      assetID: asset.id,
      path: asset.path,
      kind: asset.kind,
      status: "succeeded",
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      ...(asset.assetRef ? { assetRef: asset.assetRef, assetStatus: "ready" } : {}),
    },
  }
}

function generatedAssetCanonicalRef(
  projectID: string,
  asset: Awaited<ReturnType<typeof CinemaAssetLibrary.registerCinemaGeneratedAsset>>["asset"],
): CinemaAssetRef {
  return {
    scope: { type: "project", projectID },
    assetID: asset.id,
    contentRevision: asset.contentRevision,
    snapshot: {
      kind: asset.kind,
      displayName: asset.displayName,
      mimeType: asset.mimeType,
      ...(asset.width ? { width: asset.width } : {}),
      ...(asset.height ? { height: asset.height } : {}),
      ...(asset.durationSeconds !== undefined ? { durationSeconds: asset.durationSeconds } : {}),
    },
  }
}

async function registerCompletedGenerationAssets(
  projectID: string,
  projectRoot: string,
  task: CinemaGenerationTask,
): Promise<CinemaGenerationTask> {
  if (task.status !== "succeeded") return task
  const candidates = task.outputAssets.filter((asset) => (
    !asset.assetRef && (asset.kind === "image" || asset.kind === "video" || asset.kind === "audio")
  ))
  if (candidates.length === 0) return task

  let revision = (await CinemaAssetLibrary.getCinemaAssetLibraryState({ type: "project", projectID })).revision
  let changed = false
  const outputAssets: CinemaGeneratedAsset[] = []
  for (let index = 0; index < task.outputAssets.length; index += 1) {
    const output = task.outputAssets[index]!
    if (output.assetRef || !["image", "video", "audio"].includes(output.kind) || /^[a-z][a-z0-9+.-]*:/i.test(output.path)) {
      outputAssets.push(output)
      continue
    }
    const sourcePath = path.isAbsolute(output.path) ? path.resolve(output.path) : path.resolve(projectRoot, output.path)
    const relativeToProject = path.relative(projectRoot, sourcePath)
    const sourceInfo = relativeToProject.startsWith("..") || path.isAbsolute(relativeToProject)
      ? undefined
      : await stat(sourcePath).catch(() => undefined)
    if (!sourceInfo?.isFile()) {
      outputAssets.push(output)
      continue
    }

    const registered = await CinemaAssetLibrary.registerCinemaGeneratedAsset(projectID, {
      operationID: `generation-${task.id}-${index}`.slice(0, 128),
      baseRevision: revision,
      sourcePath,
      kind: output.kind as "image" | "video" | "audio",
      mimeType: output.mimeType,
      displayName: path.basename(sourcePath, path.extname(sourcePath)),
      source: "generation",
    })
    revision = registered.revision
    changed = true
    outputAssets.push({
      ...output,
      id: registered.asset.id,
      path: path.posix.join("assets/library", registered.asset.relativePath.replace(/\\/g, "/")),
      mimeType: registered.asset.mimeType,
      sizeBytes: registered.asset.sizeBytes,
      width: registered.asset.width,
      height: registered.asset.height,
      assetRef: generatedAssetCanonicalRef(projectID, registered.asset),
    })
  }

  return changed ? { ...task, outputAssets } : task
}

type SyncTaskToCanvasOptions = {
  claimImageTask?: boolean
}

function canSyncTaskToImageNode(
  node: CinemaCanvasNode,
  task: CinemaGenerationTask,
  options: SyncTaskToCanvasOptions,
) {
  if (cinemaImageNodeHasContent(node.data)) return false
  if (stringValue(node.data?.taskID) === task.id) return true
  return Boolean(options.claimImageTask) && !isActiveCinemaImageNodeData(node.data)
}

function syncTaskToCanvasDocument(
  canvas: CinemaCanvasDocument,
  task: CinemaGenerationTask,
  options: SyncTaskToCanvasOptions = {},
): CinemaCanvasDocument {
  const taskNodeID = task.taskNodeID ?? `node-generation-task-${task.id}`
  const existingTaskNode = canvas.nodes.find((node) => node.id === taskNodeID)
  if (existingTaskNode?.type === "image") {
    if (!canSyncTaskToImageNode(existingTaskNode, task, options)) return canvas
    return withNodeTypes({
      ...canvas,
      nodes: canvas.nodes.map((node) => node.id === taskNodeID
        ? {
          ...node,
          data: imageTaskNodeDataFor(task, node.data),
        }
        : node),
    })
  }

  const taskNodeType = existingTaskNode?.type === "video" ? "video" : "generation-task"
  const nextTaskNode = taskNodeFor(
    task,
    existingTaskNode?.position,
    taskNodeType,
    existingTaskNode?.size,
  )
  let nodes = existingTaskNode
    ? canvas.nodes.map((node) => node.id === taskNodeID
      ? {
        ...node,
        title: taskNodeType === "video" ? node.title : nextTaskNode.title,
        data: {
          ...node.data,
          ...taskNodeDataFor(task),
        },
      }
      : node)
    : [...canvas.nodes, nextTaskNode]

  let edges = canvas.edges
  const outputNode = taskNodeType === "video" ? null : task.status === "succeeded" ? outputNodeFor(task) : null
  if (outputNode) {
    const existingOutputNode = nodes.find((node) => node.id === outputNode.id)
    nodes = existingOutputNode
      ? nodes.map((node) => node.id === outputNode.id
        ? {
          ...node,
          title: outputNode.title,
          data: {
            ...node.data,
            ...outputNode.data,
          },
        }
        : node)
      : [...nodes, outputNode]

    const edgeID = `edge-${taskNodeID}-${outputNode.id}`
    if (!edges.some((edge) => edge.id === edgeID)) {
      edges = [
        ...edges,
        {
          id: edgeID,
          source: taskNodeID,
          target: outputNode.id,
        },
      ]
    }
  }

  return withNodeTypes({
    ...canvas,
    nodes,
    edges,
  })
}

async function syncTaskToCanvas(
  cinemaRoot: string,
  task: CinemaGenerationTask,
  message: string,
  options: SyncTaskToCanvasOptions = {},
) {
  const canvas = await mutateCinemaCanvasFromRoot(
    cinemaRoot,
    (current) => syncTaskToCanvasDocument(current, task, options),
  )
  await appendCinemaEvent(cinemaRoot, {
    time: nowISO(),
    type: "generation-task.synced",
    actor: "cinema-runtime",
    message,
    data: { taskID: task.id, status: task.status },
  })
  return canvas
}

export async function getCinemaProject(projectID: string): Promise<CinemaProjectSummary> {
  const { project, root, cinemaRoot } = resolveCinemaRoot(projectID)
  const projectPath = path.join(cinemaRoot, PROJECT_FILE)
  const initialized = await pathExists(projectPath)
  let metadata: Record<string, unknown> | undefined

  if (initialized) {
    try {
      metadata = await readOptionalJson(projectPath)
    } catch (error) {
      throw createInvalidJsonError(PROJECT_FILE, error)
    }
  }

  return {
    projectID: project.id,
    name: project.name?.trim() || path.basename(root) || project.id,
    root,
    initialized,
    metadataPath: path.join(CINEMA_DIRECTORY, PROJECT_FILE),
    ...(metadata ? { project: metadata } : {}),
    capabilities: {
      assetLibrary: !["0", "false", "off"].includes(
        getProcessEnvValue("ANYBOX_CINEMA_ASSET_LIBRARY")?.trim().toLowerCase() ?? "",
      ),
      personalAssetLibrary: !["0", "false", "off"].includes(
        getProcessEnvValue("ANYBOX_CINEMA_ASSET_LIBRARY")?.trim().toLowerCase() ?? "",
      ),
      timelineEditing: true,
      timelineDelivery: false,
    },
  }
}

export async function listCinemaTimelines(projectID: string): Promise<CinemaTimelineListResult> {
  const { cinemaRoot } = resolveCinemaRoot(projectID)
  await assertCinemaProjectInitialized(cinemaRoot)
  return {
    timelines: await CinemaTimelineStorage.listCinemaTimelineDocuments(cinemaRoot),
  }
}

export async function createCinemaTimeline(
  projectID: string,
  input: CreateCinemaTimelineBody,
): Promise<CinemaTimelineDocument> {
  const { cinemaRoot } = resolveCinemaRoot(projectID)
  await assertCinemaProjectInitialized(cinemaRoot)

  const existing = await CinemaTimelineStorage.listCinemaTimelineDocuments(cinemaRoot)
  const timestamp = nowISO()
  const timeline: CinemaTimelineDocument = {
    schemaVersion: 1,
    id: randomUUID(),
    projectID,
    title: input.title ?? `Timeline ${existing.length + 1}`,
    revision: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    settings: input.settings ?? {
      width: 1920,
      height: 1080,
      frameRate: { numerator: 24, denominator: 1 },
      sampleRate: 48_000,
      backgroundColor: "#000000",
    },
    tracks: [
      {
        id: randomUUID(),
        kind: "video",
        title: "V1",
        order: 0,
        locked: false,
        muted: false,
        hidden: false,
      },
      {
        id: randomUUID(),
        kind: "audio",
        title: "A1",
        order: 1,
        locked: false,
        muted: false,
        hidden: false,
      },
    ],
    clips: [],
    markers: [],
  }

  await CinemaTimelineStorage.writeCinemaTimelineDocument(cinemaRoot, timeline)
  return timeline
}

export async function getCinemaTimeline(
  projectID: string,
  timelineID: string,
): Promise<CinemaTimelineDocument> {
  const { cinemaRoot } = resolveCinemaRoot(projectID)
  await assertCinemaProjectInitialized(cinemaRoot)
  const timeline = await CinemaTimelineStorage.readCinemaTimelineDocument(cinemaRoot, timelineID)
  if (!timeline) {
    throw new ApiError(404, "CINEMA_TIMELINE_NOT_FOUND", `Timeline '${timelineID}' was not found.`)
  }
  if (timeline.projectID !== projectID) {
    throw new ApiError(409, "CINEMA_TIMELINE_PROJECT_MISMATCH", "Timeline belongs to another project.")
  }
  return timeline
}

function cinemaTimelineLockKey(cinemaRoot: string, timelineID: string) {
  return `cinema-timeline:${cinemaRoot}:${timelineID}`
}

async function validateTimelineCommandAsset(projectID: string, command: CinemaTimelineCommand) {
  const assetRef = command.type === "add-clip" && command.clip.kind !== "text"
    ? command.clip.assetRef
    : command.type === "update-clip"
      ? command.patch.assetRef
      : undefined
  if (!assetRef) return
  if (assetRef.scope.type === "project" && assetRef.scope.projectID !== projectID) {
    throw new ApiError(400, "CINEMA_ASSET_SCOPE_INVALID", "Timeline cannot reference an asset owned by another project.")
  }
  const { asset } = await CinemaAssetLibrary.getCinemaAsset(assetRef.scope, assetRef.assetID)
  if (asset.status !== "ready") {
    throw new ApiError(409, "CINEMA_ASSET_NOT_READY", `Asset '${asset.id}' is ${asset.status}.`)
  }
  if (asset.contentRevision !== assetRef.contentRevision) {
    throw new ApiError(409, "CINEMA_ASSET_REVISION_STALE", "Refresh the asset before adding it to the Timeline.")
  }
  if (asset.kind !== assetRef.snapshot.kind) {
    throw new ApiError(409, "CINEMA_ASSET_KIND_MISMATCH", "Asset kind does not match the Timeline reference snapshot.")
  }
}

export async function applyCinemaTimelineCommand(
  projectID: string,
  timelineID: string,
  command: CinemaTimelineCommand,
): Promise<CinemaTimelineCommandResult> {
  const { cinemaRoot } = resolveCinemaRoot(projectID)
  await assertCinemaProjectInitialized(cinemaRoot)
  if (timelineID !== command.timelineID) {
    throw new ApiError(400, "CINEMA_TIMELINE_COMMAND_TARGET_MISMATCH", "Command targets a different Timeline.")
  }

  using _lock = await Lock.write(cinemaTimelineLockKey(cinemaRoot, timelineID))
  const current = await getCinemaTimeline(projectID, timelineID)
  const events = await CinemaTimelineStorage.readCinemaTimelineEvents(cinemaRoot, timelineID)
  const previousEvent = events.find((event) => event.commandID === command.id)
  if (previousEvent) {
    return { timeline: current, event: previousEvent }
  }

  await validateTimelineCommandAsset(projectID, command)
  const timestamp = nowISO()
  const next = applyCinemaTimelineCommandToDocument(current, command, timestamp)
  const event = {
    time: timestamp,
    timelineID,
    type: `timeline.${command.type}`,
    actor: command.actor,
    commandID: command.id,
    baseRevision: command.baseRevision,
    revision: next.revision,
    message: `Applied Timeline command '${command.type}'.`,
    command,
  }
  await CinemaTimelineStorage.writeCinemaTimelineDocument(cinemaRoot, next)
  try {
    await CinemaTimelineStorage.appendCinemaTimelineEvent(cinemaRoot, event)
  } catch (error) {
    await CinemaTimelineStorage.writeCinemaTimelineDocument(cinemaRoot, current).catch(() => undefined)
    throw error
  }
  return { timeline: next, event }
}

export async function getCinemaTimelineEvents(
  projectID: string,
  timelineID: string,
  options: { after?: number; limit?: number } = {},
): Promise<CinemaTimelineEventsResult> {
  const { cinemaRoot } = resolveCinemaRoot(projectID)
  await assertCinemaProjectInitialized(cinemaRoot)
  await getCinemaTimeline(projectID, timelineID)
  const after = options.after ?? 0
  const limit = options.limit ?? 100
  const allEvents = await CinemaTimelineStorage.readCinemaTimelineEvents(cinemaRoot, timelineID)
  const events = allEvents.slice(after, after + limit)
  return { events, nextCursor: after + events.length }
}

export async function getCinemaTimelineWaveform(
  projectID: string,
  timelineID: string,
  clipID: string,
) {
  const { cinemaRoot } = resolveCinemaRoot(projectID)
  await assertCinemaProjectInitialized(cinemaRoot)
  const timeline = await getCinemaTimeline(projectID, timelineID)
  return await CinemaTimelineWaveform.getCinemaTimelineClipWaveform({
    projectID,
    cinemaRoot,
    timeline,
    clipID,
  })
}

export async function deleteCinemaTimeline(
  projectID: string,
  timelineID: string,
): Promise<DeleteCinemaTimelineResult> {
  const { cinemaRoot } = resolveCinemaRoot(projectID)
  await assertCinemaProjectInitialized(cinemaRoot)
  using _lock = await Lock.write(cinemaTimelineLockKey(cinemaRoot, timelineID))
  await getCinemaTimeline(projectID, timelineID)
  await CinemaTimelineStorage.deleteCinemaTimelineStorage(cinemaRoot, timelineID)
  return { timelineID, deleted: true }
}

export async function getCinemaCanvas(projectID: string): Promise<CinemaCanvasDocument> {
  const { cinemaRoot } = resolveCinemaRoot(projectID)
  return await readCinemaCanvasFromRoot(cinemaRoot)
}

export async function listCinemaProjectDirectory(
  projectID: string,
  directoryPath?: string,
): Promise<CinemaProjectDirectoryListing> {
  const { root, cinemaRoot } = resolveCinemaRoot(projectID)
  await assertCinemaProjectInitialized(cinemaRoot)
  const { relativePath, resolvedPath } = resolveProjectRelativeDirectory(root, directoryPath)
  const directoryStat = await stat(resolvedPath).catch((error: unknown) => {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new ApiError(404, "CINEMA_DIRECTORY_NOT_FOUND", "Project directory was not found.")
    }
    throw error
  })
  if (!directoryStat.isDirectory()) {
    throw new ApiError(400, "CINEMA_DIRECTORY_NOT_DIRECTORY", "Requested path is not a project directory.")
  }

  const dirents = await readdir(resolvedPath, { withFileTypes: true })
  const visibleDirents = dirents
    .filter((entry) => !shouldSkipProjectDirectoryEntry(entry.name))
    .filter((entry) => entry.isDirectory() || entry.isFile())
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  const listedDirents = visibleDirents.slice(0, PROJECT_DIRECTORY_LIST_LIMIT)
  const entries = (await Promise.all(listedDirents.map(async (entry): Promise<CinemaProjectDirectoryEntry | null> => {
    const entryPath = path.join(resolvedPath, entry.name)
    const entryRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name
    const entryStat = await stat(entryPath).catch(() => null)
    if (!entryStat) return null
    const kind = entry.isDirectory() ? "directory" : "file"
    const mimeType = kind === "file" ? projectAssetMimeForPath(entryPath) ?? undefined : undefined
    return {
      name: entry.name,
      path: entryRelativePath,
      kind,
      modifiedAt: entryStat.mtime.toISOString(),
      ...(kind === "file" ? { sizeBytes: entryStat.size } : {}),
      ...(mimeType ? { mimeType } : {}),
      previewable: Boolean(mimeType && isSupportedPreviewAssetMime(mimeType)),
    }
  }))).filter((entry): entry is CinemaProjectDirectoryEntry => entry !== null)

  return CinemaProjectDirectoryListingSchema.parse({
    projectID,
    root,
    path: relativePath,
    parentPath: parentProjectDirectoryPath(relativePath),
    entries,
    truncated: visibleDirents.length > PROJECT_DIRECTORY_LIST_LIMIT,
  })
}

export async function importCinemaProjectImageAsset(
  projectID: string,
  input: CreateCinemaImportedImageAssetBody,
): Promise<CinemaImportedImageAssetResult> {
  const { root, cinemaRoot } = resolveCinemaRoot(projectID)
  await assertCinemaProjectInitialized(cinemaRoot)

  const suppliedMimeType = input.mimeType?.split(";")[0]?.trim().toLowerCase()
  const fallbackMimeType = imageMimeForPath(input.fileName) ?? undefined
  const mimeType = suppliedMimeType && isSupportedImageMime(suppliedMimeType)
    ? suppliedMimeType
    : fallbackMimeType
  if (!mimeType || !isSupportedImageMime(mimeType)) {
    throw new ApiError(415, "CINEMA_IMAGE_MIME_UNSUPPORTED", "Only image files can be imported into Cinema.")
  }

  const dataBase64 = input.dataBase64.trim().startsWith("data:")
    ? input.dataBase64.trim().slice(input.dataBase64.trim().indexOf(",") + 1)
    : input.dataBase64.trim()
  const bytes = Buffer.from(dataBase64, "base64")
  if (bytes.byteLength === 0) {
    throw new ApiError(400, "CINEMA_IMAGE_IMPORT_EMPTY", "Imported image was empty.")
  }
  if (bytes.byteLength > CINEMA_PROJECT_IMAGE_ASSET_MAX_BYTES) {
    throw new ApiError(413, "CINEMA_IMAGE_ASSET_TOO_LARGE", "Imported image is too large.")
  }

  const extension = imageExtensionForMime(mimeType)
  if (!extension) {
    throw new ApiError(415, "CINEMA_IMAGE_MIME_UNSUPPORTED", "Only image files can be imported into Cinema.")
  }

  const importDirectory = path.join(root, "assets", "imported")
  await mkdir(importDirectory, { recursive: true })

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const id = `import-${timestamp}-${randomUUID().slice(0, 8)}`
  const filePath = path.join(importDirectory, `${safeImportedImageBaseName(input.fileName)}-${id}${extension}`)
  await writeFile(filePath, bytes)

  return {
    asset: {
      id,
      kind: "image",
      path: projectRelativePath(root, filePath),
      mimeType,
      sizeBytes: bytes.byteLength,
      ...readImageDimensions(bytes, mimeType),
    },
  }
}

export const listCinemaVideoProviders = CinemaProviderRuntime.listCinemaVideoProviders
export const refreshCinemaVideoProviderCatalog = CinemaProviderRuntime.refreshCinemaVideoProviderCatalog
export const getCinemaVideoProvider = CinemaProviderRuntime.getCinemaVideoProvider
export const getCinemaVideoProviderAuth = CinemaProviderRuntime.getCinemaVideoProviderAuth
export const saveCinemaVideoProviderApiKey = CinemaProviderRuntime.saveCinemaVideoProviderApiKey
export const saveCinemaVideoProviderSettings = CinemaProviderRuntime.saveCinemaVideoProviderSettings
export const testCinemaVideoProviderConnection = CinemaProviderRuntime.testCinemaVideoProviderConnection

export async function listCinemaTextModels(projectID: string): Promise<CinemaTextModelsResult> {
  const { cinemaRoot } = resolveCinemaRoot(projectID)
  await assertCinemaProjectInitialized(cinemaRoot)

  const publicModels = await cinemaTextRuntimeDependencies.listModels(projectID)
  const textPublicModels = publicModels.filter(isTextOutputModel)
  const items = textPublicModels.map(toCinemaTextModel)
  const selection = await cinemaTextRuntimeDependencies.resolveSelection(projectID, textPublicModels)
  const effectivePublicModel = await cinemaTextRuntimeDependencies.resolveEffectiveModel(projectID, textPublicModels, selection.model)
  const effectiveModel = effectivePublicModel ? toCinemaTextModel(effectivePublicModel) : null
  const selectedModel = findCinemaTextModel(items, selection.model)

  return {
    items,
    selection: {
      model: selectedModel?.value ?? null,
    },
    effectiveModel,
  }
}

async function resolveCinemaTextGenerationModel(projectID: string, requestedModel: string | null | undefined) {
  const textModels = await listCinemaTextModels(projectID)
  const requested = findCinemaTextModel(textModels.items, requestedModel)
  const selected = requested ?? textModels.effectiveModel ?? null

  if (!selected) {
    throw new ApiError(
      400,
      "CINEMA_TEXT_MODEL_NOT_AVAILABLE",
      "No text generation model is available for this project.",
    )
  }

  try {
    const model = await cinemaTextRuntimeDependencies.getModel(selected.providerID, selected.modelID, projectID)
    if (!model.capabilities.input.text || !model.capabilities.output.text) {
      throw new ApiError(
        400,
        "CINEMA_TEXT_MODEL_NOT_CAPABLE",
        `Model '${selected.value}' does not support text input and output.`,
      )
    }
    return { model, textModel: selected }
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (ModelRegistry.isModelNotFoundError(error)) {
      throw new ApiError(
        400,
        "CINEMA_TEXT_MODEL_NOT_AVAILABLE",
        `Model '${selected.value}' is not available for this project.`,
      )
    }
    throw error
  }
}

export async function createCinemaTextGeneration(
  projectID: string,
  input: CreateCinemaTextGenerationBody,
): Promise<CinemaTextGenerationResult> {
  const { root, cinemaRoot } = resolveCinemaRoot(projectID)
  await assertCinemaProjectInitialized(cinemaRoot)

  const prompt = input.prompt.trim()
  if (!prompt) {
    throw new ApiError(400, "CINEMA_TEXT_PROMPT_EMPTY", "Text generation prompt cannot be empty.")
  }

  const current = await readCinemaCanvasFromRoot(cinemaRoot)
  const node = current.nodes.find((item) => item.id === input.nodeID)
  if (!node) {
    throw new ApiError(404, "CINEMA_NODE_NOT_FOUND", `Cinema node '${input.nodeID}' was not found.`)
  }
  if (node.type !== "text") {
    throw new ApiError(409, "CINEMA_TEXT_NODE_INVALID", `Cinema node '${input.nodeID}' is not a text node.`)
  }

  const currentText = typeof node.data?.text === "string" ? node.data.text : ""
  const { model, textModel } = await resolveCinemaTextGenerationModel(projectID, input.model)
  const sourceImagePaths = uniqueNonEmptyStrings([
    ...(input.sourceImagePaths ?? []),
    input.sourceImagePath,
  ])
  const sourceImageAssetIDs = uniqueNonEmptyStrings([
    ...(input.sourceImageAssetIDs ?? []),
    input.sourceImageAssetID,
  ])
  const sourceImages = await Promise.all(
    sourceImagePaths.map((sourceImagePath) => readCinemaTextGenerationSourceImage(root, sourceImagePath))
  )
  if (sourceImages.length > 0 && !model.capabilities.input.image) {
    throw new ApiError(
      400,
      "CINEMA_TEXT_MODEL_IMAGE_INPUT_NOT_CAPABLE",
      `Model '${textModel.value}' does not support image input.`,
    )
  }

  const result = await Instance.provide({
    directory: root,
    fn: async () => {
      try {
        const languageModel = await cinemaTextRuntimeDependencies.getLanguage(model, projectID)
        const generateText: GenerateTextFunction = await cinemaTextRuntimeDependencies.getGenerateText()
        const generationPrompt = buildCinemaTextGenerationPrompt({
          currentText,
          prompt,
        })
        const request = sourceImages.length > 0
          ? {
            model: languageModel,
            system: CINEMA_TEXT_GENERATION_SYSTEM_PROMPT,
            messages: [
              {
                role: "user" as const,
                content: [
                  { type: "text" as const, text: generationPrompt },
                  ...sourceImages.map((sourceImage) => ({
                    type: "image" as const,
                    image: sourceImage.data,
                    mediaType: sourceImage.mediaType,
                  })),
                ],
              },
            ],
          }
          : {
            model: languageModel,
            system: CINEMA_TEXT_GENERATION_SYSTEM_PROMPT,
            prompt: generationPrompt,
          }
        return await generateText(request as Parameters<GenerateTextFunction>[0])
      } catch (error) {
        throw createCinemaTextGenerationRuntimeError(error, textModel.value)
      }
    },
  })
  const generatedText = result.text.trim()

  if (!generatedText) {
    throw new ApiError(502, "CINEMA_TEXT_GENERATION_EMPTY", "The selected model returned an empty text generation.")
  }

  const canvas = await mutateCinemaCanvasFromRoot(cinemaRoot, (latest) => {
    const latestNode = latest.nodes.find((item) => item.id === node.id)
    if (!latestNode) {
      throw new ApiError(404, "CINEMA_NODE_NOT_FOUND", `Cinema node '${node.id}' was not found.`)
    }
    const latestText = typeof latestNode.data?.text === "string" ? latestNode.data.text : currentText
    const nextText = appendGeneratedText(latestText, generatedText)
    return withNodeTypes({
      ...latest,
      nodes: latest.nodes.map((item) =>
        item.id === node.id
          ? {
            ...item,
            data: {
              ...item.data,
              text: nextText,
              generationPrompt: "",
              textModel: textModel.value,
              ...(sourceImages.length > 0
                ? {
                  sourceImageAssetID: sourceImageAssetIDs[0],
                  sourceImageAssetIDs,
                  sourceImagePath: sourceImages[0]?.path,
                  sourceImagePaths: sourceImages.map((sourceImage) => sourceImage.path),
                }
                : {}),
            },
          }
          : item
      ),
    })
  })

  await appendCinemaEvent(cinemaRoot, {
    time: nowISO(),
    type: "text.generated",
    actor: "cinema-runtime",
    message: `Generated text for node '${node.title}'.`,
    data: {
      nodeID: node.id,
      model: textModel.value,
      generatedTextLength: generatedText.length,
      ...(sourceImages.length > 0
        ? {
          sourceImagePath: sourceImages[0]?.path,
          sourceImagePaths: sourceImages.map((sourceImage) => sourceImage.path),
        }
        : {}),
    },
  })

  const savedText = canvas.nodes.find((item) => item.id === node.id)?.data?.text

  return {
    canvas,
    nodeID: node.id,
    text: typeof savedText === "string" ? savedText : generatedText,
    generatedText,
    model: textModel.value,
  }
}

export async function listCinemaImageModels(projectID: string): Promise<CinemaImageModelsResult> {
  const { cinemaRoot } = resolveCinemaRoot(projectID)
  await assertCinemaProjectInitialized(cinemaRoot)

  const providers = await CinemaProviderRuntime.listCinemaVideoProviders()
  const items = providers.flatMap((provider) =>
    provider.manifest.models
      .filter((model) => isAvailableCinemaProviderImageModel(provider, model))
      .map((model) => toCinemaProviderImageModel(provider, model))
  )
  const effectiveModel = items[0] ?? null

  return {
    items,
    selection: {
      image_model: null,
    },
    effectiveModel,
  }
}

async function resolveCinemaImageGenerationModel(projectID: string, requestedModel: string | null | undefined) {
  const imageModels = await listCinemaImageModels(projectID)
  const requested = findCinemaImageModel(imageModels.items, requestedModel)
  const selected = requested ?? imageModels.effectiveModel ?? null

  if (!selected) {
    throw new ApiError(
      400,
      "CINEMA_IMAGE_MODEL_NOT_AVAILABLE",
      "No image generation model is available for this project.",
    )
  }

  const provider = await CinemaProviderRuntime.getCinemaVideoProvider(selected.providerID)
  const model = CINEMA_IMAGE_GENERATION_MODES
    .map((mode) => CinemaProviderRuntime.findCinemaVideoProviderModelForMode(provider.manifest, selected.modelID, mode))
    .find((item): item is CinemaGenerationProviderModel => Boolean(item && isAvailableCinemaProviderImageModel(provider, item)))
  const mode = model ? cinemaProviderModelImageGenerationMode(provider, model) : null
  if (!model || !mode) {
    throw new ApiError(
      400,
      "CINEMA_IMAGE_MODEL_NOT_CAPABLE",
      `Model '${selected.value}' does not support image generation through a connected generation provider.`,
    )
  }

  return { provider, model, imageModel: selected, mode }
}

async function saveCinemaGeneratedImageAssets(input: {
  root: string
  nodeID: string
  images: Array<{ uint8Array: Uint8Array; mediaType: string }>
}) {
  const nodeSegment = safeGeneratedImageNodeSegment(input.nodeID)
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const outputDirectory = path.join(input.root, "generated", "images", nodeSegment)
  await mkdir(outputDirectory, { recursive: true })

  const assets: CinemaGeneratedAsset[] = []
  for (const [index, image] of input.images.entries()) {
    const mimeType = image.mediaType.toLowerCase()
    const extension = imageExtensionForMime(mimeType)
    if (!extension || !isSupportedImageMime(mimeType)) {
      throw new ApiError(
        415,
        "CINEMA_IMAGE_MIME_UNSUPPORTED",
        `Generated image ${index + 1} has unsupported MIME type '${image.mediaType}'.`,
      )
    }

    const bytes = image.uint8Array
    if (bytes.byteLength === 0) {
      throw new ApiError(502, "CINEMA_IMAGE_GENERATION_EMPTY", `Generated image ${index + 1} was empty.`)
    }
    if (bytes.byteLength > CINEMA_PROJECT_IMAGE_ASSET_MAX_BYTES) {
      throw new ApiError(413, "CINEMA_IMAGE_ASSET_TOO_LARGE", `Generated image ${index + 1} is too large to save.`)
    }

    const filePath = path.join(outputDirectory, `${timestamp}-${index + 1}${extension}`)
    await writeFile(filePath, bytes)
    const dimensions = readImageDimensions(bytes, mimeType)
    assets.push({
      id: `image-${timestamp}-${index + 1}`,
      kind: "image",
      path: projectRelativePath(input.root, filePath),
      mimeType,
      sizeBytes: bytes.byteLength,
      ...dimensions,
    })
  }

  return assets
}

async function writeCinemaImageNodeFailure(input: {
  cinemaRoot: string
  nodeID: string
  error: string
}) {
  await mutateCinemaCanvasFromRoot(input.cinemaRoot, (current) => {
    const currentNode = current.nodes.find((node) => node.id === input.nodeID)
    if (
      !currentNode ||
      currentNode.type !== "image" ||
      cinemaImageNodeHasContent(currentNode.data) ||
      isActiveCinemaImageNodeData(currentNode.data)
    ) return current

    return withNodeTypes({
      ...current,
      nodes: current.nodes.map((item) =>
        item.id === input.nodeID
          ? {
            ...item,
            data: {
              ...item.data,
              status: "failed",
              error: input.error,
              progress: progressForTaskStatus("failed", nowISO(), input.error),
            },
          }
          : item
      ),
    })
  })
}

export async function createCinemaImageGeneration(
  projectID: string,
  input: CreateCinemaImageGenerationBody,
): Promise<CinemaImageGenerationResult> {
  const { root, cinemaRoot } = resolveCinemaRoot(projectID)
  await assertCinemaProjectInitialized(cinemaRoot)

  const prompt = input.prompt.trim()
  if (!prompt) {
    throw new ApiError(400, "CINEMA_IMAGE_PROMPT_EMPTY", "Image generation prompt cannot be empty.")
  }

  const current = await readCinemaCanvasFromRoot(cinemaRoot)
  const node = current.nodes.find((item) => item.id === input.nodeID)
  if (!node) {
    throw new ApiError(404, "CINEMA_NODE_NOT_FOUND", `Cinema node '${input.nodeID}' was not found.`)
  }
  if (node.type !== "image") {
    throw new ApiError(409, "CINEMA_IMAGE_NODE_INVALID", `Cinema node '${input.nodeID}' is not an image node.`)
  }
  assertImageNodeAcceptsGeneration(node)

  try {
    const { provider, model, imageModel, mode } = await resolveCinemaImageGenerationModel(projectID, input.model)
    const formSpec = imageModel.formSpec
    const defaults = await cinemaImageRuntimeDependencies.getImageGenerationSettings(projectID)
    const baseParameters: Record<string, unknown> = {
      ...generationFormDefaultParameters(formSpec),
      ...input.parameters,
    }
    const shouldApplyLegacyDefaults = !formSpec
    const count = input.count ?? numberValue(baseParameters.count) ?? (shouldApplyLegacyDefaults ? defaults.default_count ?? 1 : undefined)
    const size = input.size ?? stringValue(baseParameters.size) ?? (shouldApplyLegacyDefaults ? defaults.default_size : undefined)
    if (count !== undefined && (!Number.isInteger(count) || count < 1)) {
      throw new ApiError(400, "CINEMA_IMAGE_COUNT_INVALID", "Image generation count must be a positive integer.")
    }
    if (size && !/^\d+x\d+$/.test(size)) {
      throw new ApiError(400, "CINEMA_IMAGE_SIZE_INVALID", "Image generation size must use WIDTHxHEIGHT.")
    }

    const sourceNodeIDs = uniqueNonEmptyStrings(input.sourceNodeIDs ?? [])
    const sourceTextPrompts = uniqueNonEmptyStrings(input.sourceTextPrompts ?? [])
    const sourceImagePaths = uniqueNonEmptyStrings([
      ...(input.sourceImagePaths ?? []),
      input.sourceImagePath,
    ])
    const sourceImageAssetIDs = uniqueNonEmptyStrings([
      ...(input.sourceImageAssetIDs ?? []),
      input.sourceImageAssetID,
    ])
    if (sourceImagePaths.length > 0 && !cinemaProviderModelSupportsImageInput(model)) {
      throw new ApiError(
        400,
        "CINEMA_IMAGE_MODEL_IMAGE_INPUT_NOT_CAPABLE",
        `Model '${imageModel.value}' does not support image input.`,
      )
    }
    const sourceImages = await Promise.all(
      sourceImagePaths.map((sourceImagePath) => readCinemaImageGenerationSourceImage(root, sourceImagePath))
    )
    const parameters: Record<string, unknown> = {
      ...baseParameters,
      ...(size ? { size } : {}),
      ...(count !== undefined ? { count } : {}),
      ...(input.style?.trim() ? { style: input.style.trim() } : {}),
      userPrompt: input.userPrompt?.trim() ?? prompt,
      ...(sourceTextPrompts.length > 0 ? { sourceTextPrompts } : {}),
      ...(sourceImages.length > 0
        ? {
          image_list: sourceImages.slice(0, 10).map((sourceImage, index) => ({
            image: sourceImage.path,
            ...(sourceImageAssetIDs[index] ? { assetID: sourceImageAssetIDs[index] } : {}),
          })),
          sourceImageAssetID: sourceImageAssetIDs[0],
          sourceImageAssetIDs,
          sourceImagePath: sourceImages[0]?.path,
          sourceImagePaths: sourceImages.map((sourceImage) => sourceImage.path),
        }
        : {}),
    }
    const taskID = makeTaskID()
    const createdAt = nowISO()
    const taskInput: CreateCinemaGenerationTaskBody = {
      providerID: imageModel.providerID,
      modelID: imageModel.modelID,
      mode,
      title: node.title,
      prompt,
      sourceNodeIDs,
      parameters,
      taskNodeID: node.id,
    }
    const providerModel = CinemaProviderRuntime.assertCinemaVideoProviderModelSupports(taskInput, provider.manifest)
    const taskModelID = CinemaProviderRuntime.cinemaVideoProviderTaskModelID(providerModel)
    const combinationParameters = cinemaProviderInputCombinationParameters(providerModel, mode, parameters)
    const taskParameters = {
      ...parameters,
      ...combinationParameters,
      modelSelectionID: imageModel.modelID,
      providerModelID: taskModelID,
      ...(providerModel.offeringID ? { offeringID: providerModel.offeringID } : {}),
    }
    const task = taskWithCanvasIDs({
      id: taskID,
      projectID,
      providerID: imageModel.providerID,
      modelID: taskModelID,
      mode,
      title: node.title,
      status: "queued",
      createdAt,
      updatedAt: createdAt,
      taskNodeID: node.id,
      input: {
        prompt,
        sourceNodeIDs,
        parameters: taskParameters,
      },
      outputAssets: [],
      error: null,
      progress: progressForTaskStatus("queued", createdAt),
    }, { createOutputNode: false })
    const adapter = CinemaProviderRuntime.getCinemaVideoProviderAdapter(provider.manifest.id)
    const createdResult = taskWithProgress(taskWithCanvasIDs(await Instance.provide({
      directory: root,
      fn: async () => {
        try {
          return await adapter.createTask({ root, cinemaRoot, task, canvas: current })
        } catch (error) {
          throw createCinemaImageGenerationRuntimeError(error, imageModel.value)
        }
      },
    }), { createOutputNode: false }))
    const created = await registerCompletedGenerationAssets(projectID, root, createdResult)
    await writeGenerationTask(cinemaRoot, created)
    const canvas = await syncTaskToCanvas(
      cinemaRoot,
      created,
      `Created image generation task '${created.title}'.`,
      { claimImageTask: true },
    )
    await appendTaskAuditEvent(cinemaRoot, {
      time: nowISO(),
      type: "generation-task.created",
      actor: "cinema-runtime",
      taskID: created.id,
      message: `Created image generation task '${created.title}'.`,
      data: { task: created },
    })
    const assets = created.outputAssets.flatMap((asset) => asset.kind === "image" ? [{ ...asset, kind: "image" as const }] : [])

    return {
      canvas,
      nodeID: node.id,
      model: imageModel.value,
      taskID: created.id,
      status: created.status,
      assets,
    }
  } catch (error) {
    const message = compactImageGenerationError(error)
    await writeCinemaImageNodeFailure({
      cinemaRoot,
      nodeID: node.id,
      error: message,
    }).catch(() => undefined)
    await appendCinemaEvent(cinemaRoot, {
      time: nowISO(),
      type: "image.generation_failed",
      actor: "cinema-runtime",
      message: `Image generation failed for node '${node.title}'.`,
      data: {
        nodeID: node.id,
        error: message,
      },
    }).catch(() => undefined)

    if (error instanceof ApiError) throw error
    throw createCinemaImageGenerationRuntimeError(error, input.model ?? "selected image model")
  }
}

async function renderCustomApiRequest(input: {
  projectID: string
  runID: string
  node: CinemaCanvasNode
  canvas: CinemaCanvasDocument
  inputValues: Record<string, unknown>
  includeSecret: boolean
}) {
  const config = readCustomApiNodeConfig(input.node)
  const mergedInputValues = {
    ...config.inputValues,
    ...input.inputValues,
  }
  const context = buildCustomApiTemplateContext({
    projectID: input.projectID,
    runID: input.runID,
    node: input.node,
    canvas: input.canvas,
    inputValues: mergedInputValues,
  })
  const url = validateCustomApiURL(String(renderCustomApiTemplate(config.request.url, context)))
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(config.request.headersTemplate)) {
    const headerName = key.trim()
    if (!headerName) continue
    headers[headerName] = String(renderCustomApiTemplate(value, context))
  }
  const body = renderCustomApiTemplate(config.request.bodyTemplate, context)

  if (config.auth.type !== "none") {
    if (!input.includeSecret) {
      const headerName = config.auth.type === "bearer" ? "Authorization" : config.auth.headerName ?? "X-API-Key"
      headers[headerName] = config.auth.type === "bearer" ? "Bearer [redacted]" : "[redacted]"
    } else {
      const runtimeAuth = await ProviderAuth.resolveProviderRuntimeAuth(config.auth.credentialProviderID, {}, {
        method: "api-key",
      })
      if (!runtimeAuth.apiKey) {
        throw new ApiError(
          400,
          "CINEMA_CUSTOM_API_AUTH_NOT_CONNECTED",
          "Custom API node requires an API key before it can run.",
        )
      }
      if (config.auth.type === "bearer") {
        headers.Authorization = `Bearer ${runtimeAuth.apiKey}`
      } else {
        headers[config.auth.headerName ?? "X-API-Key"] = runtimeAuth.apiKey
      }
    }
  }

  return {
    inputValues: mergedInputValues,
    timeoutMs: config.request.timeoutMs,
    mapping: config.outputMapping,
    request: {
      method: "POST" as const,
      url,
      headers,
      body,
    },
  }
}

export async function saveCinemaCustomApiNodeApiKey(
  projectID: string,
  nodeID: string,
  apiKey: string | null | undefined,
): Promise<CinemaCustomApiAuthState> {
  const { cinemaRoot } = resolveCinemaRoot(projectID)
  await assertCinemaProjectInitialized(cinemaRoot)

  const canvas = await readCinemaCanvasFromRoot(cinemaRoot)
  const node = canvas.nodes.find((item) => item.id === nodeID)
  if (!node) {
    throw new ApiError(404, "CINEMA_NODE_NOT_FOUND", `Cinema node '${nodeID}' was not found.`)
  }
  if (!isCustomApiRuntimeNode(node)) {
    throw new ApiError(409, "CINEMA_CUSTOM_API_NODE_INVALID", `Cinema node '${nodeID}' is not a Custom API node.`)
  }

  const credentialProviderID = customApiCredentialProviderIDFor(node)
  await ProviderAuth.saveProviderApiKey(credentialProviderID, apiKey)
  return await customApiAuthStateFor(node)
}

export async function createCinemaCustomApiRun(
  projectID: string,
  input: CreateCinemaCustomApiRunBody,
): Promise<CinemaCustomApiRunResult> {
  const { cinemaRoot } = resolveCinemaRoot(projectID)
  await assertCinemaProjectInitialized(cinemaRoot)

  const canvas = await readCinemaCanvasFromRoot(cinemaRoot)
  const node = canvas.nodes.find((item) => item.id === input.nodeID)
  if (!node) {
    throw new ApiError(404, "CINEMA_NODE_NOT_FOUND", `Cinema node '${input.nodeID}' was not found.`)
  }
  if (!isCustomApiRuntimeNode(node)) {
    throw new ApiError(409, "CINEMA_CUSTOM_API_NODE_INVALID", `Cinema node '${input.nodeID}' is not a Custom API node.`)
  }

  const runID = `custom-api-run-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
  const mode = input.mode ?? "run"

  let rendered: Awaited<ReturnType<typeof renderCustomApiRequest>>
  try {
    rendered = await renderCustomApiRequest({
      projectID,
      runID,
      node,
      canvas,
      inputValues: input.inputValues ?? {},
      includeSecret: mode === "run",
    })
  } catch (error) {
    if (mode === "run") {
      const message = errorMessage(error)
      await writeCustomApiNodeFailure({
        cinemaRoot,
        nodeID: node.id,
        inputValues: input.inputValues ?? {},
        error: message,
      }).catch(() => undefined)
      await appendCinemaEvent(cinemaRoot, {
        time: nowISO(),
        type: "custom-api.failed",
        actor: "cinema-runtime",
        message: `Custom API run failed for node '${node.title}'.`,
        data: {
          nodeID: node.id,
          error: message,
        },
      }).catch(() => undefined)
    }
    throw error
  }

  const requestPreview = {
    ...rendered.request,
    headers: sanitizeHeaders(rendered.request.headers),
  }

  if (mode === "preview") {
    return {
      nodeID: node.id,
      requestPreview,
    }
  }

  try {
    const result = await executeCustomApiJsonRequest({
      url: rendered.request.url,
      headers: rendered.request.headers,
      body: rendered.request.body,
      timeoutMs: rendered.timeoutMs,
    })
    const output = mapCustomApiResponse(result.responseJson, rendered.mapping)
    const writtenCanvas = await mutateCinemaCanvasFromRoot(cinemaRoot, (latest) => writeCustomApiNodeResult({
      canvas: latest,
      nodeID: node.id,
      inputValues: rendered.inputValues,
      output,
      statusCode: result.statusCode,
      status: "succeeded",
    }))
    await appendCinemaEvent(cinemaRoot, {
      time: nowISO(),
      type: "custom-api.generated",
      actor: "cinema-runtime",
      message: `Ran Custom API node '${node.title}'.`,
      data: {
        nodeID: node.id,
        statusCode: result.statusCode,
        outputTextLength: output.text?.length ?? 0,
        hasJsonOutput: output.json !== undefined,
        hasImageUrlOutput: Boolean(output.imageUrl),
      },
    })

    return {
      nodeID: node.id,
      requestPreview,
      statusCode: result.statusCode,
      responsePreview: result.responseJson,
      output,
      canvas: writtenCanvas,
      elapsedMs: result.elapsedMs,
    }
  } catch (error) {
    const message = errorMessage(error)
    await writeCustomApiNodeFailure({
      cinemaRoot,
      nodeID: node.id,
      inputValues: rendered.inputValues,
      error: message,
    }).catch(() => undefined)
    await appendCinemaEvent(cinemaRoot, {
      time: nowISO(),
      type: "custom-api.failed",
      actor: "cinema-runtime",
      message: `Custom API run failed for node '${node.title}'.`,
      data: {
        nodeID: node.id,
        error: message,
      },
    }).catch(() => undefined)

    if (error instanceof ApiError) throw error
    throw new ApiError(502, "CINEMA_CUSTOM_API_REQUEST_FAILED", `Custom API request failed: ${message}`)
  }
}

export async function readCinemaProjectAsset(
  projectID: string,
  assetPath: string,
  options: ReadCinemaProjectAssetOptions = {},
) {
  const { root, cinemaRoot } = resolveCinemaRoot(projectID)
  await assertCinemaProjectInitialized(cinemaRoot)

  const filePath = resolveProjectRelativeFile(root, assetPath)
  const mimeType = projectAssetMimeForPath(filePath)
  if (!mimeType || !isSupportedPreviewAssetMime(mimeType)) {
    throw new ApiError(415, "CINEMA_ASSET_MIME_UNSUPPORTED", "Only project image and video assets can be previewed.")
  }

  const fileStat = await stat(filePath).catch((error: unknown) => {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new ApiError(404, "CINEMA_ASSET_NOT_FOUND", "Project asset was not found.")
    }
    throw error
  })
  if (!fileStat.isFile()) {
    throw new ApiError(415, "CINEMA_ASSET_MIME_UNSUPPORTED", "Only project image and video files can be previewed.")
  }
  if (fileStat.size > previewAssetMaxBytesForMime(mimeType)) {
    throw new ApiError(413, "CINEMA_ASSET_TOO_LARGE", "Project asset is too large to preview.")
  }

  const range = parseCinemaProjectAssetRange(options.rangeHeader, fileStat.size)
  const body = streamCinemaFile(filePath, range ?? undefined)

  return {
    body,
    mimeType,
    sizeBytes: fileStat.size,
    contentLength: range ? range.end - range.start + 1 : fileStat.size,
    range,
  }
}

export const readCinemaProjectImageAsset = readCinemaProjectAsset

export async function updateCinemaCanvas(projectID: string, canvas: CinemaCanvasDocument): Promise<CinemaCanvasDocument> {
  const { cinemaRoot } = resolveCinemaRoot(projectID)
  await assertCinemaProjectInitialized(cinemaRoot)
  const parsed = await mutateCinemaCanvasFromRoot(cinemaRoot, (current) => {
    const currentRevision = current.revision ?? 0
    if ((canvas.revision ?? 0) !== currentRevision) {
      throw new ApiError(
        409,
        "CINEMA_CANVAS_REVISION_CONFLICT",
        `Canvas revision conflict; latest revision is ${currentRevision}.`,
        { latestRevision: currentRevision },
      )
    }
    return canvas
  })
  await appendCinemaEvent(cinemaRoot, {
    time: new Date().toISOString(),
    type: "canvas.updated",
    actor: "cinema-web",
    message: "Updated Cinema canvas.",
  })

  return parsed
}

function taskWithCanvasIDs(task: CinemaGenerationTask, options: { createOutputNode?: boolean } = {}): CinemaGenerationTask {
  const { outputNodeID: currentOutputNodeID, ...taskWithoutOutputNodeID } = task
  const createOutputNode = options.createOutputNode ?? true
  const taskNodeID = task.taskNodeID ?? `node-generation-task-${task.id}`
  const outputNodeID = createOutputNode
    ? currentOutputNodeID ?? (task.outputAssets.length > 0 ? `node-video-${task.id}` : undefined)
    : undefined
  return {
    ...taskWithoutOutputNodeID,
    taskNodeID,
    ...(outputNodeID ? { outputNodeID } : {}),
  }
}

function isVideoTaskNode(canvas: CinemaCanvasDocument, task: CinemaGenerationTask) {
  if (!task.taskNodeID) return false
  return canvas.nodes.some((node) => node.id === task.taskNodeID && node.type === "video")
}

function isInlineGenerationTaskNode(canvas: CinemaCanvasDocument, task: CinemaGenerationTask) {
  if (!task.taskNodeID) return false
  return canvas.nodes.some((node) => node.id === task.taskNodeID && (node.type === "video" || node.type === "image"))
}

function resolveGenerationTaskNodeID(input: CreateCinemaGenerationTaskBody, taskID: string, canvas: CinemaCanvasDocument) {
  const requestedTaskNodeID = input.taskNodeID?.trim()
  if (!requestedTaskNodeID) return `node-generation-task-${taskID}`

  const existingNode = canvas.nodes.find((node) => node.id === requestedTaskNodeID)
  if (!existingNode) {
    throw new ApiError(404, "CINEMA_NODE_NOT_FOUND", `Cinema node '${requestedTaskNodeID}' was not found.`)
  }
  if (existingNode.type !== "video" && existingNode.type !== "image" && existingNode.type !== "generation-task") {
    throw new ApiError(409, "CINEMA_TASK_NODE_INVALID", "Generation tasks can only bind to video, image, or generation task nodes.")
  }
  if (existingNode.type === "image" && !isCinemaImageGenerationMode(input.mode)) {
    throw new ApiError(409, "CINEMA_TASK_NODE_INVALID", "Image nodes can only bind to image generation tasks.")
  }
  if (existingNode.type === "video" && isCinemaImageGenerationMode(input.mode)) {
    throw new ApiError(409, "CINEMA_TASK_NODE_INVALID", "Video nodes cannot bind to image generation tasks.")
  }

  return requestedTaskNodeID
}

function assertGenerationTaskNodeModelOutput(input: {
  node: CinemaCanvasNode | undefined
  model: CinemaGenerationProviderModel
  mode: CreateCinemaGenerationTaskBody["mode"]
  modelID: string
}) {
  if (input.node?.type === "video" && (!isCinemaVideoGenerationMode(input.mode) || !providerModelOutputsVideo(input.model))) {
    throw new ApiError(
      409,
      "CINEMA_TASK_NODE_MODEL_INVALID",
      `Video node '${input.node.id}' can only bind to video output models; '${input.modelID}' does not produce video output.`,
    )
  }
  if (input.node?.type === "image" && (!isCinemaImageGenerationMode(input.mode) || !providerModelOutputsImage(input.model))) {
    throw new ApiError(
      409,
      "CINEMA_TASK_NODE_MODEL_INVALID",
      `Image node '${input.node.id}' can only bind to image output models; '${input.modelID}' does not produce image output.`,
    )
  }
}

export async function createCinemaGenerationTask(
  projectID: string,
  input: CreateCinemaGenerationTaskBody,
): Promise<CinemaGenerationTask> {
  const { root, cinemaRoot } = resolveCinemaRoot(projectID)
  await assertCinemaProjectInitialized(cinemaRoot)
  const provider = await CinemaProviderRuntime.getCinemaVideoProvider(input.providerID)
  const providerModel = CinemaProviderRuntime.assertCinemaVideoProviderModelSupports(input, provider.manifest)
  const taskModelID = CinemaProviderRuntime.cinemaVideoProviderTaskModelID(providerModel)
  const combinationParameters = cinemaProviderInputCombinationParameters(providerModel, input.mode, input.parameters)
  const taskParameters = {
    ...input.parameters,
    ...combinationParameters,
    modelSelectionID: input.modelID,
    providerModelID: taskModelID,
    ...(providerModel.offeringID ? { offeringID: providerModel.offeringID } : {}),
  }

  const canvas = await readCinemaCanvasFromRoot(cinemaRoot)
  const createdAt = nowISO()
  const taskID = makeTaskID()
  const taskNodeID = resolveGenerationTaskNodeID(input, taskID, canvas)
  const taskNode = canvas.nodes.find((node) => node.id === taskNodeID)
  assertGenerationTaskNodeModelOutput({
    node: taskNode,
    model: providerModel,
    mode: input.mode,
    modelID: input.modelID,
  })
  if (taskNode?.type === "image" && isCinemaImageGenerationMode(input.mode)) {
    assertImageNodeAcceptsGeneration(taskNode)
  }
  const createOutputNode = !canvas.nodes.some((node) => node.id === taskNodeID && (node.type === "video" || node.type === "image"))
  const adapter = CinemaProviderRuntime.getCinemaVideoProviderAdapter(input.providerID)
  const task = taskWithCanvasIDs({
    id: taskID,
    projectID,
    providerID: input.providerID,
    modelID: taskModelID,
    mode: input.mode,
    title: titleForGenerationTask(input),
    status: "queued",
    createdAt,
    updatedAt: createdAt,
    taskNodeID,
    input: {
      prompt: input.prompt,
      sourceNodeIDs: input.sourceNodeIDs,
      parameters: taskParameters,
    },
    outputAssets: [],
    error: null,
    progress: progressForTaskStatus("queued", createdAt),
  }, { createOutputNode })

  const createdResult = taskWithProgress(taskWithCanvasIDs(await adapter.createTask({ root, cinemaRoot, task, canvas }), { createOutputNode }))
  const created = await registerCompletedGenerationAssets(projectID, root, createdResult)
  await writeGenerationTask(cinemaRoot, created)
  await syncTaskToCanvas(
    cinemaRoot,
    created,
    `Created generation task '${created.title}'.`,
    { claimImageTask: true },
  )
  await appendTaskAuditEvent(cinemaRoot, {
    time: nowISO(),
    type: "generation-task.created",
    actor: "cinema-runtime",
    taskID: created.id,
    message: `Created generation task '${created.title}'.`,
    data: { task: created },
  })
  return created
}

export async function listCinemaGenerationTasks(projectID: string): Promise<CinemaGenerationTask[]> {
  const { cinemaRoot } = resolveCinemaRoot(projectID)
  await assertCinemaProjectInitialized(cinemaRoot)
  return await readGenerationTasksFromRoot(cinemaRoot)
}

export async function getCinemaGenerationTask(projectID: string, taskID: string): Promise<CinemaGenerationTask> {
  const { cinemaRoot } = resolveCinemaRoot(projectID)
  await assertCinemaProjectInitialized(cinemaRoot)
  return await readGenerationTaskFromRoot(cinemaRoot, taskID)
}

export async function refreshCinemaGenerationTask(projectID: string, taskID: string): Promise<CinemaGenerationTask> {
  const { root, cinemaRoot } = resolveCinemaRoot(projectID)
  await assertCinemaProjectInitialized(cinemaRoot)
  const task = await readGenerationTaskFromRoot(cinemaRoot, taskID)
  const adapter = CinemaProviderRuntime.getCinemaVideoProviderAdapter(task.providerID)
  const canvas = await readCinemaCanvasFromRoot(cinemaRoot)
  const refreshedResult = taskWithProgress(taskWithCanvasIDs(await adapter.refreshTask({ root, cinemaRoot, task, canvas }), {
    createOutputNode: !isInlineGenerationTaskNode(canvas, task),
  }))
  const refreshed = await registerCompletedGenerationAssets(projectID, root, refreshedResult)
  await writeGenerationTask(cinemaRoot, refreshed)
  await syncTaskToCanvas(cinemaRoot, refreshed, `Refreshed generation task '${refreshed.title}'.`)
  await appendTaskAuditEvent(cinemaRoot, {
    time: nowISO(),
    type: "generation-task.refreshed",
    actor: "cinema-runtime",
    taskID: refreshed.id,
    message: `Refreshed generation task '${refreshed.title}' (${refreshed.status}).`,
    data: { task: refreshed },
  })
  return refreshed
}

export async function cancelCinemaGenerationTask(projectID: string, taskID: string): Promise<CinemaGenerationTask> {
  const { root, cinemaRoot } = resolveCinemaRoot(projectID)
  await assertCinemaProjectInitialized(cinemaRoot)
  const task = await readGenerationTaskFromRoot(cinemaRoot, taskID)
  const adapter = CinemaProviderRuntime.getCinemaVideoProviderAdapter(task.providerID)
  const canvas = await readCinemaCanvasFromRoot(cinemaRoot)
  const canceled = taskWithProgress(taskWithCanvasIDs(await (adapter.cancelTask ?? (async ({ task: current }) => ({
    ...current,
    status: "canceled" as const,
    updatedAt: nowISO(),
    progress: progressForTaskStatus("canceled", nowISO()),
  })))({ root, cinemaRoot, task, canvas }), {
    createOutputNode: !isInlineGenerationTaskNode(canvas, task),
  }))
  await writeGenerationTask(cinemaRoot, canceled)
  await syncTaskToCanvas(cinemaRoot, canceled, `Canceled generation task '${canceled.title}'.`)
  await appendTaskAuditEvent(cinemaRoot, {
    time: nowISO(),
    type: "generation-task.canceled",
    actor: "cinema-runtime",
    taskID: canceled.id,
    message: `Canceled generation task '${canceled.title}'.`,
    data: { task: canceled },
  })
  return canceled
}

export async function applyCinemaCommand(projectID: string, command: CinemaCommand): Promise<CinemaCommandResult> {
  const { cinemaRoot } = resolveCinemaRoot(projectID)
  await assertCinemaProjectInitialized(cinemaRoot)

  using _lock = await Lock.write(cinemaCanvasLockKey(cinemaRoot))

  const events = await readCinemaEventsFromRoot(cinemaRoot, { after: 0, limit: Number.MAX_SAFE_INTEGER })
  const previousEvent = events.events.find((event) => event.commandID === command.id)
  if (previousEvent) {
    return {
      canvas: await readCinemaCanvasFromRoot(cinemaRoot),
      event: previousEvent,
    }
  }

  const current = await readCinemaCanvasFromRoot(cinemaRoot)
  const currentRevision = current.revision ?? 0
  if (command.baseRevision !== currentRevision) {
    throw new ApiError(
      409,
      "CINEMA_CANVAS_REVISION_CONFLICT",
      `Canvas revision conflict; latest revision is ${currentRevision}.`,
      { latestRevision: currentRevision },
    )
  }
  let next: CinemaCanvasDocument
  let personalReferenceToAdd: { assetID: string; nodeID: string } | undefined
  let personalReferenceToRemove: { assetID: string; nodeID: string } | undefined
  if (command.type === "create-node-from-asset" || command.type === "relink-node-asset") {
    if (command.assetRef.scope.type === "project" && command.assetRef.scope.projectID !== projectID) {
      throw new ApiError(
        400,
        "CINEMA_ASSET_SCOPE_INVALID",
        "A project Canvas cannot reference an asset owned by another project.",
      )
    }

    const existingNode = current.nodes.find((node) => node.id === command.nodeID)
    if (command.type === "create-node-from-asset" && existingNode) {
      const existingRef = existingNode.data?.assetRef
      const sameAsset = Boolean(
        existingRef
        && typeof existingRef === "object"
        && "assetID" in existingRef
        && existingRef.assetID === command.assetRef.assetID
        && "scope" in existingRef
        && JSON.stringify(existingRef.scope) === JSON.stringify(command.assetRef.scope),
      )
      if (!sameAsset) {
        throw new ApiError(409, "CINEMA_NODE_ID_CONFLICT", `Cinema node '${command.nodeID}' already exists.`)
      }
      next = current
    } else if (command.type === "create-node-from-asset") {
      const { asset } = await CinemaAssetLibrary.getCinemaAsset(command.assetRef.scope, command.assetRef.assetID)
      if (asset.status !== "ready") {
        throw new ApiError(
          409,
          "CINEMA_ASSET_NOT_READY",
          asset.status === "trashed"
            ? "Restore the asset before adding it to the Canvas."
            : "The asset must finish processing before it can be added to the Canvas.",
        )
      }
      const assetRef = {
        scope: command.assetRef.scope,
        assetID: asset.id,
        contentRevision: asset.contentRevision,
        snapshot: {
          kind: asset.kind,
          displayName: asset.displayName,
          mimeType: asset.mimeType,
          ...(asset.width ? { width: asset.width } : {}),
          ...(asset.height ? { height: asset.height } : {}),
          ...(asset.durationSeconds !== undefined ? { durationSeconds: asset.durationSeconds } : {}),
        },
      }
      const size = asset.kind === "image"
        ? { width: 300, height: 300 }
        : asset.kind === "video"
          ? { width: 420, height: 340 }
          : { width: 300, height: 156 }
      next = appendNode(current, {
        id: command.nodeID,
        type: asset.kind,
        title: asset.displayName,
        position: command.position,
        size,
        data: {
          assetRef,
          assetStatus: asset.status,
          sourceKind: command.assetRef.scope.type === "personal" ? "personal-library" : "project-library",
          sourceFileName: asset.displayName,
          status: "ready",
        },
      })
      if (command.assetRef.scope.type === "personal") {
        personalReferenceToAdd = { assetID: asset.id, nodeID: command.nodeID }
      }
    } else {
      if (!existingNode) {
        throw new ApiError(404, "CINEMA_NODE_NOT_FOUND", `Cinema node '${command.nodeID}' does not exist.`)
      }
      const { asset } = await CinemaAssetLibrary.getCinemaAsset(command.assetRef.scope, command.assetRef.assetID)
      if (asset.status !== "ready") {
        throw new ApiError(
          409,
          "CINEMA_ASSET_NOT_READY",
          asset.status === "trashed"
            ? "Restore the asset before relinking it."
            : "The asset must finish processing before it can be linked.",
        )
      }
      const existingMediaKind = existingNode.type === "local-image" ? "image" : existingNode.type
      if (existingMediaKind !== asset.kind) {
        throw new ApiError(
          409,
          "CINEMA_ASSET_KIND_MISMATCH",
          `A ${existingNode.type} node cannot be relinked to a ${asset.kind} asset.`,
        )
      }

      const previousRef = existingNode.data?.assetRef
      const previousPersonalAssetID = (
        previousRef
        && typeof previousRef === "object"
        && "assetID" in previousRef
        && typeof previousRef.assetID === "string"
        && "scope" in previousRef
        && previousRef.scope
        && typeof previousRef.scope === "object"
        && "type" in previousRef.scope
        && previousRef.scope.type === "personal"
      ) ? previousRef.assetID : undefined
      const nextPersonalAssetID = command.assetRef.scope.type === "personal" ? asset.id : undefined
      if (nextPersonalAssetID && nextPersonalAssetID !== previousPersonalAssetID) {
        personalReferenceToAdd = { assetID: nextPersonalAssetID, nodeID: command.nodeID }
      }
      if (previousPersonalAssetID && previousPersonalAssetID !== nextPersonalAssetID) {
        personalReferenceToRemove = { assetID: previousPersonalAssetID, nodeID: command.nodeID }
      }

      const assetRef: CinemaAssetRef = {
        scope: command.assetRef.scope,
        assetID: asset.id,
        contentRevision: asset.contentRevision,
        snapshot: {
          kind: asset.kind,
          displayName: asset.displayName,
          mimeType: asset.mimeType,
          ...(asset.width !== undefined ? { width: asset.width } : {}),
          ...(asset.height !== undefined ? { height: asset.height } : {}),
          ...(asset.durationSeconds !== undefined ? { durationSeconds: asset.durationSeconds } : {}),
        },
      }
      const relinkedData: Record<string, unknown> = { ...existingNode.data }
      for (const legacyIdentityKey of [
        "asset",
        "assetID",
        "path",
        "resultAssets",
        "selectedAssetID",
        "candidateAssets",
        "selectedCandidateAssetID",
        "outputAssets",
      ]) {
        delete relinkedData[legacyIdentityKey]
      }
      next = withNodeTypes({
        ...current,
        nodes: current.nodes.map((node) => node.id === command.nodeID
          ? {
              ...node,
              type: asset.kind,
              data: {
                ...relinkedData,
                assetRef,
                assetStatus: "ready",
                sourceKind: command.assetRef.scope.type === "personal" ? "personal-library" : "project-library",
                sourceFileName: asset.displayName,
                status: "ready",
              },
            }
          : node),
      })
    }
  } else {
    if (command.type === "delete-node") {
      const deletedNode = current.nodes.find((node) => node.id === command.nodeID)
      const deletedAssetRef = deletedNode?.data?.assetRef
      if (
        deletedAssetRef
        && typeof deletedAssetRef === "object"
        && "assetID" in deletedAssetRef
        && typeof deletedAssetRef.assetID === "string"
        && "scope" in deletedAssetRef
        && deletedAssetRef.scope
        && typeof deletedAssetRef.scope === "object"
        && "type" in deletedAssetRef.scope
        && deletedAssetRef.scope.type === "personal"
      ) {
        personalReferenceToRemove = { assetID: deletedAssetRef.assetID, nodeID: command.nodeID }
      }
    }
    next = applyCommandToCanvas(current, command)
  }

  const nextRevision = next === current && command.type === "create-node-from-asset"
    ? current.revision ?? 0
    : (current.revision ?? 0) + 1
  if (personalReferenceToAdd) {
    await CinemaAssetLibrary.addCinemaPersonalAssetReference(
      personalReferenceToAdd.assetID,
      projectID,
      personalReferenceToAdd.nodeID,
    )
  }

  let canvas: CinemaCanvasDocument
  try {
    canvas = next === current && command.type === "create-node-from-asset"
      ? current
      : await writeCinemaCanvas(cinemaRoot, { ...next, revision: nextRevision })
  } catch (error) {
    if (personalReferenceToAdd) {
      await CinemaAssetLibrary.removeCinemaPersonalAssetReference(
        personalReferenceToAdd.assetID,
        projectID,
        personalReferenceToAdd.nodeID,
      ).catch(() => undefined)
    }
    throw error
  }

  if (personalReferenceToRemove) {
    try {
      await CinemaAssetLibrary.removeCinemaPersonalAssetReference(
        personalReferenceToRemove.assetID,
        projectID,
        personalReferenceToRemove.nodeID,
      )
    } catch (error) {
      await writeCinemaCanvas(cinemaRoot, current)
      if (personalReferenceToAdd) {
        await CinemaAssetLibrary.removeCinemaPersonalAssetReference(
          personalReferenceToAdd.assetID,
          projectID,
          personalReferenceToAdd.nodeID,
        ).catch(() => undefined)
      }
      throw error
    }
  }
  const event = await appendCinemaEvent(cinemaRoot, {
    time: new Date().toISOString(),
    type: `command.${command.type}`,
    actor: command.actor ?? "cinema-runtime",
    message: describeCinemaCommand(command),
    commandID: command.id,
    data: { command },
  })

  return { canvas, event }
}

export async function getCinemaEvents(
  projectID: string,
  options: { after?: number; limit?: number } = {},
): Promise<CinemaEventsResult> {
  const { cinemaRoot } = resolveCinemaRoot(projectID)
  await assertCinemaProjectInitialized(cinemaRoot)
  return await readCinemaEventsFromRoot(cinemaRoot, options)
}

export async function getCinemaProjectStateSummary(projectID: string): Promise<CinemaProjectStateSummary> {
  const { project, root, cinemaRoot } = resolveCinemaRoot(projectID)
  const summary = await getCinemaProject(projectID)
  const directories = await Promise.all(PROJECT_DIRECTORIES.map((directory) => summarizeProjectDirectory(root, directory)))

  if (!summary.initialized) {
    return {
      projectID: project.id,
      name: summary.name,
      root,
      initialized: false,
      nodeCount: 0,
      edgeCount: 0,
      nodeTypeCounts: {},
      nodes: [],
      recentEvents: [],
      directories,
      gaps: ["project-not-initialized"],
    }
  }

  const canvas = await readCinemaCanvasFromRoot(cinemaRoot)
  const events = await readCinemaEventsFromRoot(cinemaRoot, { limit: 10 })
  const providerConfigured = await hasConfiguredProvider(cinemaRoot)
  const nodeTypeCounts = canvas.nodes.reduce<Record<string, number>>((counts, node) => {
    counts[node.type] = (counts[node.type] ?? 0) + 1
    return counts
  }, {})

  return {
    projectID: project.id,
    name: summary.name,
    root,
    initialized: true,
    ...(summary.project ? { project: summary.project } : {}),
    nodeCount: canvas.nodes.length,
    edgeCount: canvas.edges.length,
    nodeTypeCounts,
    nodes: canvas.nodes.map(summarizeNodeData),
    recentEvents: events.events,
    directories,
    gaps: findProjectGaps(canvas, providerConfigured),
  }
}

export function getCinemaOpenLink(projectID: string): CinemaOpenLink {
  safeReadProject(projectID)

  const devURL = getProcessEnvValue("ANYBOX_CINEMA_WEB_DEV_URL")?.trim()
  const baseURL = devURL ? new URL(devURL) : new URL("/cinema/", getServerBaseURL())
  baseURL.searchParams.set("projectID", projectID)
  if (devURL) {
    baseURL.searchParams.set("agentBaseURL", getServerBaseURL().toString().replace(/\/$/, ""))
  }

  return {
    url: baseURL.toString(),
  }
}
