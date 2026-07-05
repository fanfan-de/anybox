import { randomUUID } from "node:crypto"
import { appendFile, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import {
  CinemaCanvasDocumentSchema,
  CinemaGenerationTaskSchema,
  CinemaProjectEventSchema,
  type CinemaGeneratedAsset,
  type CinemaImageGenerationResult,
  type CinemaImageModel,
  type CinemaImageModelsResult,
  type CinemaTextGenerationResult,
  type CinemaTextModel,
  type CinemaTextModelsResult,
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
  type CreateCinemaTextGenerationBody,
} from "@anybox/shared/cinema"
import { isSshWorkspaceUri } from "@anybox/shared"
import * as CinemaProviderRuntime from "#cinema/provider-runtime.ts"
import * as Config from "#config/config.ts"
import * as Provider from "#provider/provider.ts"
import * as Project from "#project/project.ts"
import { Instance } from "#project/instance.ts"
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

type GenerateTextFunction = typeof import("ai")["generateText"]
type GenerateImageFunction = typeof import("ai")["generateImage"]

export {
  setCinemaVideoProviderCatalogCacheFileForTest,
  setCinemaVideoProviderCatalogForTest,
} from "#cinema/provider-runtime.ts"

const defaultCinemaTextRuntimeDependencies = {
  getGenerateText: async () => (await import("ai")).generateText,
  getLanguage: Provider.getLanguage,
  getModel: Provider.getModel,
  listModels: listProjectModelsWithFallback,
  resolveEffectiveModel: resolveEffectiveModelWithFallback,
  resolveSelection: resolveProjectModelSelectionWithGlobalFallback,
}
let cinemaTextRuntimeDependencies = defaultCinemaTextRuntimeDependencies

const defaultCinemaImageRuntimeDependencies = {
  getGenerateImage: async () => (await import("ai")).generateImage,
  getImage: Provider.getImage,
  getImageGenerationSettings: Config.getImageGenerationSettings,
  getModel: Provider.getModel,
  listModels: listProjectModelsWithFallback,
  resolveEffectiveModel: resolveEffectiveModelWithFallback,
  resolveSelection: resolveProjectModelSelectionWithGlobalFallback,
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
const CINEMA_PROJECT_IMAGE_ASSET_MAX_BYTES = 25 * 1024 * 1024
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

const nowISO = () => new Date().toISOString()

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

function toCinemaTextModel(model: Provider.PublicModel): CinemaTextModel {
  return {
    value: textModelValue(model),
    providerID: model.providerID,
    modelID: model.id,
    label: model.name,
    providerLabel: model.providerName?.trim() || formatProviderLabel(model.providerID),
    available: model.available,
  }
}

function toCinemaImageModel(model: Provider.PublicModel): CinemaImageModel {
  return {
    value: textModelValue(model),
    providerID: model.providerID,
    modelID: model.id,
    label: model.name,
    providerLabel: model.providerName?.trim() || formatProviderLabel(model.providerID),
    available: model.available,
  }
}

function isTextOutputModel(model: Provider.PublicModel) {
  return model.available && model.capabilities.output.text
}

function isImageOutputModel(model: Provider.PublicModel) {
  return model.available && model.capabilities.output.image
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

function imageExtensionForMime(mime: string) {
  return IMAGE_EXTENSION_BY_MIME[mime.toLowerCase()] ?? null
}

function imageMimeForPath(filePath: string) {
  return IMAGE_MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()] ?? null
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
  if (Provider.InitError.isInstance(error)) {
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
  if (Provider.InitError.isInstance(error)) {
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
  const gaps: string[] = []
  if (!types.has("shot")) gaps.push("no-shot-nodes")
  if (!types.has("prompt")) gaps.push("no-prompt-nodes")
  if (!types.has("generation-task")) gaps.push("no-generation-tasks")
  if (!providerConfigured) gaps.push("no-provider-configured")
  return gaps
}

function taskNodeFor(task: CinemaGenerationTask, position = { x: 240, y: 220 }): CinemaCanvasNode {
  return {
    id: task.taskNodeID ?? `node-generation-task-${task.id}`,
    type: "generation-task",
    title: task.title,
    position,
    size: { width: 390, height: 240 },
    data: {
      text: task.input.prompt,
      taskID: task.id,
      providerID: task.providerID,
      modelID: task.modelID,
      mode: task.mode,
      status: task.status,
      sourceNodeIDs: task.input.sourceNodeIDs,
      parameters: task.input.parameters,
      outputAssets: task.outputAssets,
      error: task.error ?? null,
    },
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
  const nextTaskNode = taskNodeFor(task, existingTaskNode?.position)
  let nodes = existingTaskNode
    ? canvas.nodes.map((node) => node.id === taskNodeID
      ? {
        ...node,
        title: nextTaskNode.title,
        data: {
          ...node.data,
          ...nextTaskNode.data,
        },
      }
      : node)
    : [...canvas.nodes, nextTaskNode]

  let edges = canvas.edges
  const outputNode = task.status === "succeeded" ? outputNodeFor(task) : null
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
    if (Provider.ModelNotFoundError.isInstance(error)) {
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
  const result = await Instance.provide({
    directory: root,
    fn: async () => {
      try {
        const languageModel = await cinemaTextRuntimeDependencies.getLanguage(model, projectID)
        const generateText: GenerateTextFunction = await cinemaTextRuntimeDependencies.getGenerateText()
        return await generateText({
          model: languageModel,
          system: CINEMA_TEXT_GENERATION_SYSTEM_PROMPT,
          prompt: buildCinemaTextGenerationPrompt({
            currentText,
            prompt,
          }),
        })
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

  const publicModels = await cinemaImageRuntimeDependencies.listModels(projectID)
  const imagePublicModels = publicModels.filter(isImageOutputModel)
  const items = imagePublicModels.map(toCinemaImageModel)
  const selection = await cinemaImageRuntimeDependencies.resolveSelection(projectID, imagePublicModels)
  const effectivePublicModel = await cinemaImageRuntimeDependencies.resolveEffectiveModel(projectID, imagePublicModels, selection.image_model)
  const effectiveModel = effectivePublicModel ? toCinemaImageModel(effectivePublicModel) : null
  const selectedModel = findCinemaImageModel(items, selection.image_model)

  return {
    items,
    selection: {
      image_model: selectedModel?.value ?? null,
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

  try {
    const model = await cinemaImageRuntimeDependencies.getModel(selected.providerID, selected.modelID, projectID)
    if (!model.capabilities.input.text || !model.capabilities.output.image) {
      throw new ApiError(
        400,
        "CINEMA_IMAGE_MODEL_NOT_CAPABLE",
        `Model '${selected.value}' does not support text-to-image generation.`,
      )
    }
    return { model, imageModel: selected }
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (Provider.ModelNotFoundError.isInstance(error)) {
      throw new ApiError(
        400,
        "CINEMA_IMAGE_MODEL_NOT_AVAILABLE",
        `Model '${selected.value}' is not available for this project.`,
      )
    }
    throw error
  }
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

    const { model, imageModel } = await resolveCinemaImageGenerationModel(projectID, input.model)
    const generationResult = await Instance.provide({
      directory: root,
      fn: async () => {
        try {
          const imageRuntimeModel = await cinemaImageRuntimeDependencies.getImage(model, projectID)
          const generateImage: GenerateImageFunction = await cinemaImageRuntimeDependencies.getGenerateImage()
          return await generateImage({
            model: imageRuntimeModel,
            prompt: normalizeImagePrompt(prompt, input.style),
            n: count,
            ...(size ? { size: size as `${number}x${number}` } : {}),
            maxRetries: 0,
          })
        } catch (error) {
          throw createCinemaImageGenerationRuntimeError(error, imageModel.value)
        }
      },
    })
    const generatedImages = generationResult.images.map((image) => ({
      uint8Array: image.uint8Array,
      mediaType: image.mediaType,
    }))
    if (generatedImages.length === 0) {
      throw new ApiError(502, "CINEMA_IMAGE_GENERATION_EMPTY", "The selected model returned no images.")
    }

    const assets = await saveCinemaGeneratedImageAssets({
      root,
      nodeID: node.id,
      images: generatedImages,
    })
    const generatedAt = nowISO()
    const nextCanvas = withNodeTypes({
      ...current,
      nodes: current.nodes.map((item) =>
        item.id === node.id
          ? {
            ...item,
            data: {
              ...item.data,
              prompt,
              style: input.style?.trim() || (typeof item.data?.style === "string" ? item.data.style : undefined),
              model: imageModel.value,
              size,
              count,
              status: "succeeded",
              resultAssets: assets,
              selectedAssetID: assets[0]?.id,
              error: null,
              generatedAt,
            },
          }
          : item
      ),
    })
    const canvas = await writeCinemaCanvas(cinemaRoot, nextCanvas)

    await appendCinemaEvent(cinemaRoot, {
      time: generatedAt,
      type: "image.generated",
      actor: "cinema-runtime",
      message: `Generated ${assets.length} image${assets.length === 1 ? "" : "s"} for node '${node.title}'.`,
      data: {
        nodeID: node.id,
        model: imageModel.value,
        size,
        count,
        assetPaths: assets.map((asset) => asset.path),
      },
    })

    return {
      canvas,
      nodeID: node.id,
      model: imageModel.value,
      assets: assets.map((asset) => ({ ...asset, kind: "image" })),
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

export async function readCinemaProjectImageAsset(projectID: string, assetPath: string) {
  const { root, cinemaRoot } = resolveCinemaRoot(projectID)
  await assertCinemaProjectInitialized(cinemaRoot)

  const filePath = resolveProjectRelativeFile(root, assetPath)
  const mimeType = imageMimeForPath(filePath)
  if (!mimeType || !isSupportedImageMime(mimeType)) {
    throw new ApiError(415, "CINEMA_ASSET_MIME_UNSUPPORTED", "Only project image assets can be previewed.")
  }

  const fileStat = await stat(filePath).catch((error: unknown) => {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new ApiError(404, "CINEMA_ASSET_NOT_FOUND", "Project asset was not found.")
    }
    throw error
  })
  if (!fileStat.isFile()) {
    throw new ApiError(415, "CINEMA_ASSET_MIME_UNSUPPORTED", "Only project image files can be previewed.")
  }
  if (fileStat.size > CINEMA_PROJECT_IMAGE_ASSET_MAX_BYTES) {
    throw new ApiError(413, "CINEMA_ASSET_TOO_LARGE", "Project image asset is too large to preview.")
  }

  return {
    bytes: await readFile(filePath),
    mimeType,
    sizeBytes: fileStat.size,
  }
}

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

function taskWithCanvasIDs(task: CinemaGenerationTask): CinemaGenerationTask {
  const taskNodeID = task.taskNodeID ?? `node-generation-task-${task.id}`
  const outputNodeID = task.outputNodeID ?? (task.outputAssets.length > 0 ? `node-video-${task.id}` : undefined)
  return {
    ...task,
    taskNodeID,
    ...(outputNodeID ? { outputNodeID } : {}),
  }
}

export async function createCinemaGenerationTask(
  projectID: string,
  input: CreateCinemaGenerationTaskBody,
): Promise<CinemaGenerationTask> {
  const { root, cinemaRoot } = resolveCinemaRoot(projectID)
  await assertCinemaProjectInitialized(cinemaRoot)
  const provider = await CinemaProviderRuntime.getCinemaVideoProvider(input.providerID)
  CinemaProviderRuntime.assertCinemaVideoProviderModelSupports(input, provider.manifest)
  const adapter = CinemaProviderRuntime.getCinemaVideoProviderAdapter(input.providerID)

  const canvas = await readCinemaCanvasFromRoot(cinemaRoot)
  const createdAt = nowISO()
  const taskID = makeTaskID()
  const task = taskWithCanvasIDs({
    id: taskID,
    projectID,
    providerID: input.providerID,
    modelID: input.modelID,
    mode: input.mode,
    title: titleForGenerationTask(input),
    status: "queued",
    createdAt,
    updatedAt: createdAt,
    taskNodeID: `node-generation-task-${taskID}`,
    input: {
      prompt: input.prompt,
      sourceNodeIDs: input.sourceNodeIDs,
      parameters: input.parameters,
    },
    outputAssets: [],
    error: null,
  })

  const created = taskWithCanvasIDs(await adapter.createTask({ root, cinemaRoot, task, canvas }))
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
  const refreshed = taskWithCanvasIDs(await adapter.refreshTask({ root, cinemaRoot, task, canvas }))
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
  const canceled = taskWithCanvasIDs(await (adapter.cancelTask ?? (async ({ task: current }) => ({
    ...current,
    status: "canceled" as const,
    updatedAt: nowISO(),
  })))({ root, cinemaRoot, task, canvas }))
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
