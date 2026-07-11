import { createHash, randomUUID } from "node:crypto"
import { appendFile, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { isDeepStrictEqual } from "node:util"
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
  type CinemaEventsResult,
  type GenerationFormSpec,
  type CinemaNodeType,
  type CinemaOpenLink,
  type CinemaProjectEvent,
  type CinemaProjectSummary,
  type CinemaProjectStateSummary,
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
import {
  isCinemaRenderTerminalStatus,
  type CinemaRenderJob,
  type CinemaRenderSettings,
  type CreateCinemaRenderJobBody,
  type RetryCinemaRenderJobBody,
} from "@anybox/shared/cinema-render"
import * as ProviderAuth from "#auth/provider-auth.ts"
import * as CinemaProviderRuntime from "#cinema/provider-runtime.ts"
import * as CinemaAssetLibrary from "#cinema/asset-library.ts"
import * as CinemaTimelineStorage from "#cinema/timeline-storage.ts"
import {
  defaultCinemaRenderSettings,
  preflightCinemaRender,
} from "#cinema/render-preflight.ts"
import {
  cleanupCinemaRenderJobRetention,
  type CinemaRenderRetentionResult,
} from "#cinema/render-retention.ts"
import { recoverCinemaRenderJobsOnce } from "#cinema/render-recovery.ts"
import { cinemaRenderQueue } from "#cinema/render-queue.ts"
import { selectCinemaRenderExecutionRuntime } from "#cinema/render-runtime.ts"
import {
  cloneCinemaRenderInputs,
  readCinemaRenderTimelineSnapshot,
  writeCinemaRenderTimelineSnapshot,
} from "#cinema/render-snapshot.ts"
import {
  appendCinemaRenderJobEvent,
  listCinemaRenderJobs as listStoredCinemaRenderJobs,
  readCinemaRenderJob,
  readCinemaRenderJobEvents,
  writeCinemaRenderJob,
} from "#cinema/render-storage.ts"
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
import * as PromptPresets from "#session/support/prompt-presets.ts"
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
        const type = node.type
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
    for (const type of input.nodeTypes) nodeTypes.add(type)
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
  const hasGenerationTask = canvas.nodes.some((node) =>
    (node.type === "video" || node.type === "image") && typeof node.data?.taskID === "string" && node.data.taskID.trim().length > 0
  )
  const gaps: string[] = []
  if (!types.has("text")) gaps.push("no-text-nodes")
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
  const existingTaskNode = canvas.nodes.find((node) => node.id === task.taskNodeID)
  if (!existingTaskNode || (existingTaskNode.type !== "image" && existingTaskNode.type !== "video")) {
    return canvas
  }
  if (existingTaskNode.type === "image" && !canSyncTaskToImageNode(existingTaskNode, task, options)) {
    return canvas
  }

  return withNodeTypes({
    ...canvas,
    nodes: canvas.nodes.map((node) => node.id === task.taskNodeID
      ? {
        ...node,
        data: existingTaskNode.type === "image"
          ? imageTaskNodeDataFor(task, node.data)
          : { ...node.data, ...taskNodeDataFor(task) },
      }
      : node),
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
    const recovery = await recoverCinemaRenderJobsOnce(cinemaRoot)
    await cinemaRenderQueue.resume(cinemaRoot, projectID, recovery.queuedJobIDs)
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
      timelineDelivery: ["1", "true", "on"].includes(
        getProcessEnvValue("ANYBOX_CINEMA_TIMELINE_DELIVERY")?.trim().toLowerCase() ?? "",
      ),
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
    schemaVersion: 2,
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

export async function preflightCinemaTimelineDelivery(
  projectID: string,
  timelineID: string,
  settings?: CinemaRenderSettings,
) {
  const { cinemaRoot } = resolveCinemaRoot(projectID)
  await assertCinemaProjectInitialized(cinemaRoot)
  const timeline = await getCinemaTimeline(projectID, timelineID)
  return await preflightCinemaRender({
    cinemaRoot,
    projectID,
    timeline,
    settings: settings ?? defaultCinemaRenderSettings(timeline),
  })
}

async function findCinemaRenderJobByOperationID(cinemaRoot: string, operationID: string) {
  return (await listStoredCinemaRenderJobs(cinemaRoot)).find((job) => job.operationID === operationID)
}

function cinemaRenderProjectLockKey(cinemaRoot: string) {
  return `cinema-render-project:${cinemaRoot}`
}

function assertCinemaRenderOperationMatches(
  previous: CinemaRenderJob,
  request:
    | { kind: "create"; timelineID: string; input: CreateCinemaRenderJobBody }
    | { kind: "retry"; originalJobID: string },
) {
  const matches = request.kind === "create"
    ? previous.retryOfJobID === undefined
      && previous.timelineID === request.timelineID
      && previous.timelineRevision === request.input.expectedTimelineRevision
      && isDeepStrictEqual(previous.settings, request.input.settings)
    : previous.retryOfJobID === request.originalJobID
  if (!matches) {
    throw new ApiError(
      409,
      "CINEMA_RENDER_OPERATION_CONFLICT",
      "Operation ID has already been used for a different render request.",
    )
  }
}

async function requireCinemaRenderJob(projectID: string, jobID: string) {
  const { cinemaRoot } = resolveCinemaRoot(projectID)
  await assertCinemaProjectInitialized(cinemaRoot)
  const job = await readCinemaRenderJob(cinemaRoot, jobID)
  if (!job || job.projectID !== projectID) {
    throw new ApiError(404, "CINEMA_RENDER_JOB_NOT_FOUND", `Render job '${jobID}' was not found.`)
  }
  return { cinemaRoot, job }
}

export async function createCinemaRenderJob(
  projectID: string,
  timelineID: string,
  input: CreateCinemaRenderJobBody,
) {
  const { cinemaRoot } = resolveCinemaRoot(projectID)
  await assertCinemaProjectInitialized(cinemaRoot)
  const result = await (async () => {
    using _operationLock = await Lock.write(cinemaRenderProjectLockKey(cinemaRoot))
    const previous = await findCinemaRenderJobByOperationID(cinemaRoot, input.operationID)
    if (previous) {
      assertCinemaRenderOperationMatches(previous, { kind: "create", timelineID, input })
      return { job: previous, shouldEnqueue: previous.status === "queued" }
    }

    const timeline = await getCinemaTimeline(projectID, timelineID)
    if (timeline.revision !== input.expectedTimelineRevision) {
      throw new ApiError(
        409,
        "CINEMA_TIMELINE_REVISION_CONFLICT",
        "Timeline revision changed before the render job was created.",
        { latestRevision: timeline.revision },
      )
    }
    const preflight = await preflightCinemaRender({
      cinemaRoot,
      projectID,
      timeline,
      settings: input.settings,
    })
    if (!preflight.ready) {
      throw new ApiError(
        409,
        "CINEMA_RENDER_PREFLIGHT_BLOCKED",
        "Timeline delivery preflight is blocked.",
        preflight,
      )
    }

    let executionRuntime
    try {
      executionRuntime = (await selectCinemaRenderExecutionRuntime()).executionRuntime
    } catch {
      throw new ApiError(
        503,
        "CINEMA_RENDER_RUNTIME_UNAVAILABLE",
        "The render runtime or required encoder is unavailable.",
      )
    }

    const timestamp = nowISO()
    const job: CinemaRenderJob = {
      schemaVersion: 1,
      id: `render-${randomUUID()}`,
      projectID,
      timelineID,
      timelineRevision: timeline.revision,
      operationID: input.operationID,
      status: "queued",
      settings: input.settings,
      progress: { phase: "queued", message: "Waiting for the render queue" },
      executionRuntime,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await writeCinemaRenderJob(cinemaRoot, job)
    try {
      await writeCinemaRenderTimelineSnapshot(cinemaRoot, job.id, timeline)
      await appendCinemaRenderJobEvent(cinemaRoot, {
        schemaVersion: 1,
        id: `render-event-${randomUUID()}`,
        jobID: job.id,
        type: "job-created",
        createdAt: timestamp,
        executionRuntime,
        message: "Render job was created.",
      })
    } catch {
      const failed: CinemaRenderJob = {
        ...job,
        status: "failed",
        progress: { phase: "failed", message: "Timeline snapshot could not be created." },
        error: {
          code: "snapshot-failed",
          message: "Timeline snapshot could not be created.",
          retryable: true,
          diagnosticSummary: { phase: "queued" },
        },
        finishedAt: nowISO(),
        updatedAt: nowISO(),
      }
      await writeCinemaRenderJob(cinemaRoot, failed).catch(() => undefined)
      throw new ApiError(500, "CINEMA_RENDER_JOB_CREATE_FAILED", "Render job could not be persisted.")
    }
    return { job, shouldEnqueue: true }
  })()
  if (result.shouldEnqueue) {
    await cinemaRenderQueue.enqueue({ cinemaRoot, projectID, jobID: result.job.id })
  }
  return result.job
}

export async function listCinemaRenderJobs(projectID: string, timelineID: string) {
  const { cinemaRoot } = resolveCinemaRoot(projectID)
  await assertCinemaProjectInitialized(cinemaRoot)
  await getCinemaTimeline(projectID, timelineID)
  return {
    items: (await listStoredCinemaRenderJobs(cinemaRoot))
      .filter((job) => job.projectID === projectID && job.timelineID === timelineID),
  }
}

export async function getCinemaRenderJob(projectID: string, jobID: string) {
  return (await requireCinemaRenderJob(projectID, jobID)).job
}

export async function getCinemaRenderJobEvents(projectID: string, jobID: string) {
  const { cinemaRoot } = await requireCinemaRenderJob(projectID, jobID)
  return { items: await readCinemaRenderJobEvents(cinemaRoot, jobID) }
}

export async function cancelCinemaRenderJob(projectID: string, jobID: string) {
  const { cinemaRoot, job } = await requireCinemaRenderJob(projectID, jobID)
  if (isCinemaRenderTerminalStatus(job.status)) return job
  return await cinemaRenderQueue.cancel(cinemaRoot, jobID) ?? job
}

export async function retryCinemaRenderJob(
  projectID: string,
  jobID: string,
  input: RetryCinemaRenderJobBody,
) {
  const { cinemaRoot, job: original } = await requireCinemaRenderJob(projectID, jobID)
  const result = await (async () => {
    using _operationLock = await Lock.write(cinemaRenderProjectLockKey(cinemaRoot))
    const previous = await findCinemaRenderJobByOperationID(cinemaRoot, input.operationID)
    if (previous) {
      assertCinemaRenderOperationMatches(previous, { kind: "retry", originalJobID: original.id })
      return { job: previous, shouldEnqueue: previous.status === "queued" }
    }
    if (original.status !== "failed" && original.status !== "canceled" && original.status !== "interrupted") {
      throw new ApiError(409, "CINEMA_RENDER_JOB_NOT_RETRYABLE", "Only failed, canceled, or interrupted jobs can be retried.")
    }
    const timeline = await readCinemaRenderTimelineSnapshot(cinemaRoot, original.id)
    if (!timeline) {
      throw new ApiError(409, "CINEMA_RENDER_SNAPSHOT_MISSING", "The original Timeline snapshot is unavailable.")
    }
    let executionRuntime
    try {
      executionRuntime = (await selectCinemaRenderExecutionRuntime()).executionRuntime
    } catch {
      throw new ApiError(
        503,
        "CINEMA_RENDER_RUNTIME_UNAVAILABLE",
        "The render runtime or required encoder is unavailable.",
      )
    }
    const timestamp = nowISO()
    const retry: CinemaRenderJob = {
      schemaVersion: 1,
      id: `render-${randomUUID()}`,
      projectID,
      timelineID: original.timelineID,
      timelineRevision: original.timelineRevision,
      operationID: input.operationID,
      retryOfJobID: original.id,
      status: "queued",
      settings: original.settings,
      progress: { phase: "queued", message: "Waiting for the render queue" },
      executionRuntime,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await writeCinemaRenderJob(cinemaRoot, retry)
    await writeCinemaRenderTimelineSnapshot(cinemaRoot, retry.id, timeline)
    await cloneCinemaRenderInputs(cinemaRoot, original.id, retry.id).catch((error) => {
      if (error instanceof Error && error.message === "Render job input snapshot must be a physical directory") return []
      throw error
    })
    await appendCinemaRenderJobEvent(cinemaRoot, {
      schemaVersion: 1,
      id: `render-event-${randomUUID()}`,
      jobID: retry.id,
      type: "job-created",
      createdAt: timestamp,
      executionRuntime,
      message: `Retry of render job '${original.id}'.`,
    })
    return { job: retry, shouldEnqueue: true }
  })()
  if (result.shouldEnqueue) {
    await cinemaRenderQueue.enqueue({ cinemaRoot, projectID, jobID: result.job.id })
  }
  return result.job
}

export type RunCinemaRenderRetentionInput = {
  operationID: string
  retentionDurationMs: number
  dryRun: boolean
}

export type RunCinemaRenderRetentionResult = CinemaRenderRetentionResult & {
  operationID: string
  retentionDurationMs: number
}

const CINEMA_RENDER_RETENTION_OPERATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

function cinemaRenderRetentionJournalPath(cinemaRoot: string, operationID: string) {
  const digest = createHash("sha256").update(operationID).digest("hex").slice(0, 32)
  return path.join(cinemaRoot, `.render-retention-operation-${digest}.json`)
}

function parseCinemaRenderRetentionJournal(value: Record<string, unknown> | undefined) {
  if (!value) return undefined
  if (
    value.schemaVersion !== 1
    || typeof value.operationID !== "string"
    || typeof value.retentionDurationMs !== "number"
    || !Number.isSafeInteger(value.retentionDurationMs)
    || typeof value.dryRun !== "boolean"
    || !["running", "completed", "failed"].includes(String(value.phase))
  ) {
    throw new ApiError(
      500,
      "CINEMA_RENDER_RETENTION_JOURNAL_INVALID",
      "The render retention operation journal is invalid.",
    )
  }
  return value as {
    schemaVersion: 1
    operationID: string
    retentionDurationMs: number
    dryRun: boolean
    phase: "running" | "completed" | "failed"
  }
}

export async function runCinemaRenderRetention(
  projectID: string,
  input: RunCinemaRenderRetentionInput,
  signal?: AbortSignal,
): Promise<RunCinemaRenderRetentionResult> {
  const { cinemaRoot } = resolveCinemaRoot(projectID)
  await assertCinemaProjectInitialized(cinemaRoot)
  if (!CINEMA_RENDER_RETENTION_OPERATION_PATTERN.test(input.operationID)) {
    throw new ApiError(
      400,
      "CINEMA_RENDER_RETENTION_OPERATION_ID_INVALID",
      "operationID must be a safe 1-128 character identifier.",
    )
  }
  if (!Number.isSafeInteger(input.retentionDurationMs) || input.retentionDurationMs <= 0) {
    throw new ApiError(
      400,
      "CINEMA_RENDER_RETENTION_DURATION_INVALID",
      "retentionDurationMs must be an explicit positive integer.",
    )
  }

  using _renderProjectLock = await Lock.write(cinemaRenderProjectLockKey(cinemaRoot))
  const journalPath = cinemaRenderRetentionJournalPath(cinemaRoot, input.operationID)
  const previous = parseCinemaRenderRetentionJournal(await readOptionalJson(journalPath))
  if (previous) {
    if (
      previous.operationID !== input.operationID
      || previous.retentionDurationMs !== input.retentionDurationMs
      || previous.dryRun !== input.dryRun
    ) {
      throw new ApiError(
        409,
        "CINEMA_RENDER_RETENTION_OPERATION_CONFLICT",
        "The render retention operationID was already used for a different request.",
      )
    }
    throw new ApiError(
      409,
      previous.phase === "completed"
        ? "CINEMA_RENDER_RETENTION_OPERATION_REPLAYED"
        : "CINEMA_RENDER_RETENTION_OPERATION_INCOMPLETE",
      previous.phase === "completed"
        ? "The render retention operationID has already completed; use a new operationID to rescan."
        : "The render retention operation did not complete cleanly; inspect the project and use a new operationID.",
    )
  }

  const startedAt = nowISO()
  await writeJsonAtomic(journalPath, {
    schemaVersion: 1,
    operationID: input.operationID,
    retentionDurationMs: input.retentionDurationMs,
    dryRun: input.dryRun,
    phase: "running",
    startedAt,
  })
  log.info("render-retention-started", {
    projectID,
    operationID: input.operationID,
    retentionDurationMs: input.retentionDurationMs,
    dryRun: input.dryRun,
  })
  let result: CinemaRenderRetentionResult
  try {
    result = await cleanupCinemaRenderJobRetention(cinemaRoot, {
      retentionDurationMs: input.retentionDurationMs,
      dryRun: input.dryRun,
      ...(input.dryRun && signal ? { signal } : {}),
    })
  } catch (error) {
    await writeJsonAtomic(journalPath, {
      schemaVersion: 1,
      operationID: input.operationID,
      retentionDurationMs: input.retentionDurationMs,
      dryRun: input.dryRun,
      phase: "failed",
      startedAt,
      failedAt: nowISO(),
    }).catch(() => undefined)
    log.warn("render-retention-failed", {
      projectID,
      operationID: input.operationID,
      retentionDurationMs: input.retentionDurationMs,
      dryRun: input.dryRun,
      errorName: error instanceof Error ? error.name : "UnknownError",
    })
    throw error
  }
  await writeJsonAtomic(journalPath, {
    schemaVersion: 1,
    operationID: input.operationID,
    retentionDurationMs: input.retentionDurationMs,
    dryRun: input.dryRun,
    phase: "completed",
    startedAt,
    completedAt: nowISO(),
  })
  log.info("render-retention-completed", {
    projectID,
    operationID: input.operationID,
    retentionDurationMs: input.retentionDurationMs,
    dryRun: input.dryRun,
    discoveredJobCount: result.discoveredJobCount,
    eligibleJobCount: result.eligibleJobCount,
    candidateJobCount: result.candidateJobs.length,
    cleanedJobCount: result.cleanedJobs.length,
    estimatedReclaimableBytes: result.estimatedReclaimableBytes,
    reclaimedBytes: result.reclaimedBytes,
    errorCount: result.errors.length,
  })
  return {
    operationID: input.operationID,
    retentionDurationMs: input.retentionDurationMs,
    ...result,
  }
}

function cinemaTimelineLockKey(cinemaRoot: string, timelineID: string) {
  return `cinema-timeline:${cinemaRoot}:${timelineID}`
}

async function validateTimelineCommandAsset(projectID: string, command: CinemaTimelineCommand) {
  const assetRefs = command.type === "add-clip" && command.clip.kind !== "text" && command.clip.kind !== "subtitle"
    ? [command.clip.assetRef]
    : command.type === "add-clips"
      ? command.clips.flatMap((clip) => clip.kind === "text" || clip.kind === "subtitle" ? [] : [clip.assetRef])
      : command.type === "create-track-with-clips"
        ? command.clips.flatMap((clip) => clip.kind === "text" || clip.kind === "subtitle" ? [] : [clip.assetRef])
        : command.type === "update-clip" && command.patch.assetRef
          ? [command.patch.assetRef]
          : []
  for (const assetRef of assetRefs) {
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
  const promptPresetSelection = await PromptPresets.getPromptPresetSelection(Config.GLOBAL_CONFIG_ID)
  const systemPrompt = (await PromptPresets.getResolvedPromptPresetContent(
    promptPresetSelection.cinemaTextGenerationPromptPresetID,
    Config.GLOBAL_CONFIG_ID,
  )).trim()
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
            system: systemPrompt,
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
            system: systemPrompt,
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
    const task: CinemaGenerationTask = {
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
    }
    const adapter = CinemaProviderRuntime.getCinemaVideoProviderAdapter(provider.manifest.id)
    const createdResult = taskWithProgress(bindGenerationTaskToNode(await Instance.provide({
      directory: root,
      fn: async () => {
        try {
          return await adapter.createTask({ root, cinemaRoot, task, canvas: current })
        } catch (error) {
          throw createCinemaImageGenerationRuntimeError(error, imageModel.value)
        }
      },
    }), node.id))
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

function bindGenerationTaskToNode(task: CinemaGenerationTask, taskNodeID: string): CinemaGenerationTask {
  return { ...task, taskNodeID }
}

function resolveGenerationTaskNodeID(input: CreateCinemaGenerationTaskBody, canvas: CinemaCanvasDocument) {
  const requestedTaskNodeID = input.taskNodeID.trim()
  const existingNode = canvas.nodes.find((node) => node.id === requestedTaskNodeID)
  if (!existingNode) {
    throw new ApiError(404, "CINEMA_NODE_NOT_FOUND", `Cinema node '${requestedTaskNodeID}' was not found.`)
  }
  if (existingNode.type !== "video" && existingNode.type !== "image") {
    throw new ApiError(409, "CINEMA_TASK_NODE_INVALID", "Generation tasks can only bind to video or image nodes.")
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
  const taskNodeID = resolveGenerationTaskNodeID(input, canvas)
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
  const adapter = CinemaProviderRuntime.getCinemaVideoProviderAdapter(input.providerID)
  const task: CinemaGenerationTask = {
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
  }

  const createdResult = taskWithProgress(bindGenerationTaskToNode(
    await adapter.createTask({ root, cinemaRoot, task, canvas }),
    taskNodeID,
  ))
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
  const refreshedResult = taskWithProgress(bindGenerationTaskToNode(
    await adapter.refreshTask({ root, cinemaRoot, task, canvas }),
    task.taskNodeID,
  ))
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
  const canceled = taskWithProgress(bindGenerationTaskToNode(await (adapter.cancelTask ?? (async ({ task: current }) => ({
    ...current,
    status: "canceled" as const,
    updatedAt: nowISO(),
    progress: progressForTaskStatus("canceled", nowISO()),
  })))({ root, cinemaRoot, task, canvas }), task.taskNodeID))
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
      const existingMediaKind = existingNode.type
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
