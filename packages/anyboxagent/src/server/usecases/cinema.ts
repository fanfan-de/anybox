import { randomUUID } from "node:crypto"
import { appendFile, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import {
  CinemaCanvasDocumentSchema,
  CinemaGenerationTaskSchema,
  CinemaProjectDirectoryListingSchema,
  CinemaProjectEventSchema,
  type CinemaGeneratedAsset,
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
import * as CinemaProviderRuntime from "#cinema/provider-runtime.ts"
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
const CINEMA_IMAGE_GENERATION_MODE = "text-to-image" as const
const CINEMA_CALLBACK_BASE_URL_ENV = "CINEMA_CALLBACK_BASE_URL"

const nowISO = () => new Date().toISOString()
const log = Log.create({ service: "cinema" })

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function compactErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
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
    return CinemaCanvasDocumentSchema.parse(JSON.parse(raw))
  } catch (error) {
    throw createInvalidJsonError(CANVAS_FILE, error)
  }
}

async function writeCinemaCanvas(cinemaRoot: string, canvas: CinemaCanvasDocument): Promise<CinemaCanvasDocument> {
  const parsed = CinemaCanvasDocumentSchema.parse(canvas)
  await mkdir(cinemaRoot, { recursive: true })

  const canvasPath = path.join(cinemaRoot, CANVAS_FILE)
  const tempPath = path.join(cinemaRoot, `${CANVAS_FILE}.${process.pid}.${Date.now()}.tmp`)
  await writeFile(tempPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8")
  await rename(tempPath, canvasPath)

  return parsed
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

function callbackBaseURL() {
  const value = getProcessEnvValue(CINEMA_CALLBACK_BASE_URL_ENV)?.trim()
  if (!value) return undefined

  let url: URL
  try {
    url = new URL(value.endsWith("/") ? value : `${value}/`)
  } catch {
    throw new ApiError(500, "CINEMA_CALLBACK_BASE_URL_INVALID", `${CINEMA_CALLBACK_BASE_URL_ENV} must be a valid absolute URL.`)
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ApiError(500, "CINEMA_CALLBACK_BASE_URL_INVALID", `${CINEMA_CALLBACK_BASE_URL_ENV} must use http or https.`)
  }
  return url
}

function callbackURLForTask(task: CinemaGenerationTask, token: string) {
  const baseURL = callbackBaseURL()
  if (!baseURL) return undefined

  return new URL(
    [
      "api",
      "cinema",
      "projects",
      encodeURIComponent(task.projectID),
      "provider-callbacks",
      encodeURIComponent(task.providerID),
      encodeURIComponent(task.id),
      encodeURIComponent(token),
    ].join("/"),
    baseURL,
  ).toString()
}

function readProviderCallbackRef(task: CinemaGenerationTask) {
  const callback = isRecord(task.providerTaskRef?.callback) ? task.providerTaskRef.callback : undefined
  const token = stringValue(callback?.token)
  const url = stringValue(callback?.url)
  return token ? { token, url } : undefined
}

function taskWithProviderCallback(task: CinemaGenerationTask, createdAt: string): CinemaGenerationTask {
  const existingRef = isRecord(task.providerTaskRef) ? task.providerTaskRef : {}
  const existingCallback = isRecord(existingRef.callback) ? existingRef.callback : {}
  const token = stringValue(existingCallback.token) ?? `${randomUUID()}${randomUUID()}`.replace(/-/g, "")
  const url = callbackURLForTask(task, token)
  if (!url) return task

  return {
    ...task,
    providerTaskRef: {
      ...existingRef,
      callback: {
        ...existingCallback,
        token,
        url,
        createdAt: stringValue(existingCallback.createdAt) ?? createdAt,
      },
    },
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

function toCinemaProviderImageModel(provider: CinemaGenerationProvider, model: CinemaGenerationProviderModel): CinemaImageModel {
  return {
    value: textModelValue({ providerID: provider.manifest.id, id: model.id }),
    providerID: provider.manifest.id,
    modelID: model.id,
    label: model.label,
    providerLabel: provider.manifest.name,
    available: true,
    supportsImageInput: cinemaProviderModelSupportsImageInput(model),
  }
}

function isTextOutputModel(model: PublicModel) {
  return model.available && model.capabilities.output.text
}

function isImageOutputModel(model: PublicModel) {
  return model.available && model.capabilities.output.image
}

function providerModelOutputsImage(model: CinemaGenerationProviderModel) {
  if (model.modalities?.output.includes("image")) return true
  return model.modes.some((mode) => mode.endsWith("-image") || mode === "image-edit")
}

function isAvailableCinemaProviderImageModel(provider: CinemaGenerationProvider, model: CinemaGenerationProviderModel) {
  return provider.auth.connected &&
    provider.runtime?.adapterAvailable === true &&
    CinemaProviderRuntime.cinemaVideoProviderAdapterSupportsMode(provider.manifest.id, CINEMA_IMAGE_GENERATION_MODE) &&
    model.modes.includes(CINEMA_IMAGE_GENERATION_MODE) &&
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
    .replace(/\b(sk|ak|pk)-[A-Za-z0-9._-]{8,}\b/g, "$1-[redacted]")
    .replace(/("?(?:api[_-]?key|access[_-]?token|secret)"?\s*[:=]\s*)("[^"]+"|[^\s,}]+)/gi, "$1[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
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
      return appendNode(canvas, command.node)
    case "update-node": {
      assertCanvasHasNode(canvas, command.nodeID)
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

  if (imageAssets.length > 0) {
    nextData.resultAssets = imageAssets
    nextData.selectedAssetID = imageAssets[0]!.id
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
    },
  }
}

function syncTaskToCanvasDocument(canvas: CinemaCanvasDocument, task: CinemaGenerationTask): CinemaCanvasDocument {
  const taskNodeID = task.taskNodeID ?? `node-generation-task-${task.id}`
  const existingTaskNode = canvas.nodes.find((node) => node.id === taskNodeID)
  if (existingTaskNode?.type === "image") {
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

async function syncTaskToCanvas(cinemaRoot: string, task: CinemaGenerationTask, message: string) {
  const current = await readCinemaCanvasFromRoot(cinemaRoot)
  const canvas = await writeCinemaCanvas(cinemaRoot, syncTaskToCanvasDocument(current, task))
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
  }
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

  const nextText = appendGeneratedText(currentText, generatedText)
  const nextCanvas = withNodeTypes({
    ...current,
    nodes: current.nodes.map((item) =>
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
  const canvas = await writeCinemaCanvas(cinemaRoot, nextCanvas)

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

  return {
    canvas,
    nodeID: node.id,
    text: nextText,
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
  const model = provider.manifest.models.find((item) =>
    item.id === selected.modelID && isAvailableCinemaProviderImageModel(provider, item)
  )
  if (!model || !isAvailableCinemaProviderImageModel(provider, model)) {
    throw new ApiError(
      400,
      "CINEMA_IMAGE_MODEL_NOT_CAPABLE",
      `Model '${selected.value}' does not support text-to-image generation through a connected generation provider.`,
    )
  }

  return { provider, model, imageModel: selected }
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
  canvas: CinemaCanvasDocument
  nodeID: string
  error: string
}) {
  const nextCanvas = withNodeTypes({
    ...input.canvas,
    nodes: input.canvas.nodes.map((item) =>
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
  await writeCinemaCanvas(input.cinemaRoot, nextCanvas)
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

  try {
    const defaults = await cinemaImageRuntimeDependencies.getImageGenerationSettings(projectID)
    const count = input.count ?? defaults.default_count ?? 1
    const size = input.size ?? defaults.default_size
    if (count < 1 || count > 4) {
      throw new ApiError(400, "CINEMA_IMAGE_COUNT_INVALID", "Image generation count must be between 1 and 4.")
    }
    if (size && !/^\d+x\d+$/.test(size)) {
      throw new ApiError(400, "CINEMA_IMAGE_SIZE_INVALID", "Image generation size must use WIDTHxHEIGHT.")
    }

    const { provider, model, imageModel } = await resolveCinemaImageGenerationModel(projectID, input.model)
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
      ...(size ? { size } : {}),
      count,
      ...(input.style?.trim() ? { style: input.style.trim() } : {}),
      userPrompt: input.userPrompt?.trim() ?? prompt,
      ...(sourceTextPrompts.length > 0 ? { sourceTextPrompts } : {}),
      ...(sourceImages.length > 0
        ? {
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
      mode: CINEMA_IMAGE_GENERATION_MODE,
      title: node.title,
      prompt,
      sourceNodeIDs,
      parameters,
      taskNodeID: node.id,
    }
    CinemaProviderRuntime.assertCinemaVideoProviderModelSupports(taskInput, provider.manifest)
    const task = taskWithProviderCallback(taskWithCanvasIDs({
      id: taskID,
      projectID,
      providerID: imageModel.providerID,
      modelID: imageModel.modelID,
      mode: CINEMA_IMAGE_GENERATION_MODE,
      title: node.title,
      status: "queued",
      createdAt,
      updatedAt: createdAt,
      taskNodeID: node.id,
      input: {
        prompt,
        sourceNodeIDs,
        parameters,
      },
      outputAssets: [],
      error: null,
      progress: progressForTaskStatus("queued", createdAt),
    }, { createOutputNode: false }), createdAt)
    const adapter = CinemaProviderRuntime.getCinemaVideoProviderAdapter(provider.manifest.id)
    const created = taskWithProgress(taskWithCanvasIDs(await Instance.provide({
      directory: root,
      fn: async () => {
        try {
          return await adapter.createTask({ root, cinemaRoot, task, canvas: current })
        } catch (error) {
          throw createCinemaImageGenerationRuntimeError(error, imageModel.value)
        }
      },
    }), { createOutputNode: false }))
    await writeGenerationTask(cinemaRoot, created)
    const canvas = await syncTaskToCanvas(cinemaRoot, created, `Created image generation task '${created.title}'.`)
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
      canvas: current,
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
  const bytes = await readFile(filePath)
  const responseBytes = range ? bytes.subarray(range.start, range.end + 1) : bytes

  return {
    bytes: responseBytes,
    mimeType,
    sizeBytes: fileStat.size,
    contentLength: responseBytes.byteLength,
    range,
  }
}

export const readCinemaProjectImageAsset = readCinemaProjectAsset

export async function updateCinemaCanvas(projectID: string, canvas: CinemaCanvasDocument): Promise<CinemaCanvasDocument> {
  const { cinemaRoot } = resolveCinemaRoot(projectID)
  await assertCinemaProjectInitialized(cinemaRoot)
  const parsed = await writeCinemaCanvas(cinemaRoot, canvas)
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
  if (existingNode.type === "image" && input.mode !== CINEMA_IMAGE_GENERATION_MODE) {
    throw new ApiError(409, "CINEMA_TASK_NODE_INVALID", "Image nodes can only bind to text-to-image generation tasks.")
  }
  if (existingNode.type === "video" && input.mode === CINEMA_IMAGE_GENERATION_MODE) {
    throw new ApiError(409, "CINEMA_TASK_NODE_INVALID", "Video nodes cannot bind to text-to-image generation tasks.")
  }

  return requestedTaskNodeID
}

export async function createCinemaGenerationTask(
  projectID: string,
  input: CreateCinemaGenerationTaskBody,
): Promise<CinemaGenerationTask> {
  const { root, cinemaRoot } = resolveCinemaRoot(projectID)
  await assertCinemaProjectInitialized(cinemaRoot)
  const provider = await CinemaProviderRuntime.getCinemaVideoProvider(input.providerID)
  CinemaProviderRuntime.assertCinemaVideoProviderModelSupports(input, provider.manifest)

  const canvas = await readCinemaCanvasFromRoot(cinemaRoot)
  const createdAt = nowISO()
  const taskID = makeTaskID()
  const taskNodeID = resolveGenerationTaskNodeID(input, taskID, canvas)
  const createOutputNode = !canvas.nodes.some((node) => node.id === taskNodeID && (node.type === "video" || node.type === "image"))
  const adapter = CinemaProviderRuntime.getCinemaVideoProviderAdapter(input.providerID)
  const task = taskWithProviderCallback(taskWithCanvasIDs({
    id: taskID,
    projectID,
    providerID: input.providerID,
    modelID: input.modelID,
    mode: input.mode,
    title: titleForGenerationTask(input),
    status: "queued",
    createdAt,
    updatedAt: createdAt,
    taskNodeID,
    input: {
      prompt: input.prompt,
      sourceNodeIDs: input.sourceNodeIDs,
      parameters: input.parameters,
    },
    outputAssets: [],
    error: null,
    progress: progressForTaskStatus("queued", createdAt),
  }, { createOutputNode }), createdAt)

  const created = taskWithProgress(taskWithCanvasIDs(await adapter.createTask({ root, cinemaRoot, task, canvas }), { createOutputNode }))
  await writeGenerationTask(cinemaRoot, created)
  await syncTaskToCanvas(cinemaRoot, created, `Created generation task '${created.title}'.`)
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
  const refreshed = taskWithProgress(taskWithCanvasIDs(await adapter.refreshTask({ root, cinemaRoot, task, canvas }), {
    createOutputNode: !isInlineGenerationTaskNode(canvas, task),
  }))
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

async function processCinemaProviderCallback(input: {
  projectID: string
  providerID: string
  taskID: string
  payload: unknown
}) {
  const { root, cinemaRoot } = resolveCinemaRoot(input.projectID)
  const task = await readGenerationTaskFromRoot(cinemaRoot, input.taskID)
  const adapter = CinemaProviderRuntime.getCinemaVideoProviderAdapter(input.providerID)
  if (!adapter.receiveCallback) {
    throw new ApiError(400, "CINEMA_CALLBACK_UNSUPPORTED", `Cinema provider '${input.providerID}' does not support callbacks.`)
  }

  const canvas = await readCinemaCanvasFromRoot(cinemaRoot)
  const updated = taskWithProgress(taskWithCanvasIDs(await adapter.receiveCallback({
    root,
    cinemaRoot,
    task,
    canvas,
    payload: input.payload,
  }), {
    createOutputNode: !isInlineGenerationTaskNode(canvas, task),
  }))
  await writeGenerationTask(cinemaRoot, updated)
  await syncTaskToCanvas(cinemaRoot, updated, `Processed provider callback for generation task '${updated.title}'.`)
  await appendTaskAuditEvent(cinemaRoot, {
    time: nowISO(),
    type: "generation-task.callback_processed",
    actor: "cinema-runtime",
    taskID: updated.id,
    message: `Processed provider callback for generation task '${updated.title}' (${updated.status}).`,
    data: { task: updated },
  })
}

async function appendProviderCallbackFailure(cinemaRoot: string, taskID: string, error: unknown) {
  const message = compactErrorMessage(error)
  await appendTaskAuditEvent(cinemaRoot, {
    time: nowISO(),
    type: "generation-task.callback_failed",
    actor: "cinema-runtime",
    taskID,
    message: `Provider callback processing failed: ${message}`,
    data: { error: message },
  }).catch(() => undefined)
  log.error("Cinema provider callback processing failed", { taskID, error })
}

export async function acceptCinemaProviderCallback(
  projectID: string,
  providerID: string,
  taskID: string,
  token: string,
  payload: unknown,
): Promise<{ accepted: true; projectID: string; providerID: string; taskID: string }> {
  const { cinemaRoot } = resolveCinemaRoot(projectID)
  await assertCinemaProjectInitialized(cinemaRoot)
  const task = await readGenerationTaskFromRoot(cinemaRoot, taskID)
  if (task.providerID !== providerID) {
    throw new ApiError(403, "CINEMA_CALLBACK_PROVIDER_MISMATCH", "Provider callback does not match the generation task provider.")
  }

  const callback = readProviderCallbackRef(task)
  if (!callback || callback.token !== token) {
    throw new ApiError(403, "CINEMA_CALLBACK_TOKEN_INVALID", "Provider callback token is invalid.")
  }

  const adapter = CinemaProviderRuntime.getCinemaVideoProviderAdapter(providerID)
  if (!adapter.receiveCallback) {
    throw new ApiError(400, "CINEMA_CALLBACK_UNSUPPORTED", `Cinema provider '${providerID}' does not support callbacks.`)
  }

  queueMicrotask(() => {
    void processCinemaProviderCallback({ projectID, providerID, taskID, payload })
      .catch((error: unknown) => appendProviderCallbackFailure(cinemaRoot, taskID, error))
  })

  return { accepted: true, projectID, providerID, taskID }
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

  const current = await readCinemaCanvasFromRoot(cinemaRoot)
  const next = applyCommandToCanvas(current, command)
  const canvas = await writeCinemaCanvas(cinemaRoot, next)
  const event = await appendCinemaEvent(cinemaRoot, {
    time: new Date().toISOString(),
    type: `command.${command.type}`,
    actor: command.actor ?? "cinema-runtime",
    message: describeCinemaCommand(command),
    ...(command.id ? { commandID: command.id } : {}),
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
