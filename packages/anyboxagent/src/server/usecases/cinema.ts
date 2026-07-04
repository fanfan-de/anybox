import { randomUUID } from "node:crypto"
import { appendFile, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { createFalClient, type FalClient } from "@fal-ai/client"
import {
  CinemaCanvasDocumentSchema,
  CinemaGenerationTaskSchema,
  CinemaProjectEventSchema,
  type CinemaGeneratedAsset,
  type CinemaGenerationTask,
  type CinemaGenerationTaskStatus,
  type CinemaGenerationMode,
  type CinemaCanvasNode,
  type CinemaCanvasDocument,
  type CinemaCommand,
  type CinemaCommandResult,
  type CinemaEventsResult,
  type CinemaNodeType,
  type CinemaOpenLink,
  type CinemaProviderAuthState,
  type CinemaProjectEvent,
  type CinemaProjectSummary,
  type CinemaProjectStateSummary,
  type CinemaVideoProvider,
  type CinemaVideoProviderManifest,
  type CreateCinemaGenerationTaskBody,
} from "@anybox/shared/cinema"
import { isSshWorkspaceUri } from "@anybox/shared"
import * as ProviderAuth from "#auth/provider-auth.ts"
import * as Project from "#project/project.ts"
import { ApiError } from "#server/error.ts"
import { getServerBaseURL } from "#server/base-url.ts"
import { getProcessEnvValue } from "#env/compat.ts"

const CINEMA_DIRECTORY = ".anybox-cinema"
const CANVAS_FILE = "canvas.json"
const PROJECT_FILE = "project.json"
const EVENTS_FILE = "events.jsonl"
const PROVIDERS_FILE = "providers.json"
const TASKS_FILE = "tasks.jsonl"
const TASKS_DIRECTORY = "tasks"
const MOCK_PROVIDER_ID = "mock"
const FAL_PROVIDER_ID = "fal"
const FAL_CREDENTIAL_PROVIDER_ID = "cinema-fal"
const KLING_PROVIDER_ID = "kling"
const KLING_CREDENTIAL_PROVIDER_ID = "cinema-kling"
const PROJECT_DIRECTORIES = ["assets", "references", "prompts", "generated", "renders", "exports"] as const

type ProviderAdapterCreateInput = {
  root: string
  cinemaRoot: string
  task: CinemaGenerationTask
  canvas: CinemaCanvasDocument
}

type ProviderAdapterRefreshInput = ProviderAdapterCreateInput

type ProviderAdapter = {
  manifest: CinemaVideoProviderManifest
  createTask: (input: ProviderAdapterCreateInput) => Promise<CinemaGenerationTask>
  refreshTask: (input: ProviderAdapterRefreshInput) => Promise<CinemaGenerationTask>
  cancelTask?: (input: ProviderAdapterRefreshInput) => Promise<CinemaGenerationTask>
}

type FalClientFactory = (apiKey: string) => Pick<FalClient, "queue" | "storage">

const DEFAULT_FAL_MODEL_ID = "fal-ai/wan-25-preview/text-to-video"
const DEFAULT_KLING_MODEL_ID = "kling-3.0-turbo"
const DEFAULT_KLING_BASE_URL = "https://api-singapore.klingai.com"
const DEFAULT_KLING_TEXT_TO_VIDEO_PATH = "/text-to-video/kling-3.0-turbo"
const DEFAULT_KLING_IMAGE_TO_VIDEO_PATH = "/image-to-video/kling-3.0-turbo"
const DEFAULT_KLING_TASKS_PATH = "/tasks"

type KlingCreateTaskInput = {
  mode: CinemaGenerationMode
  path: string
  payload: Record<string, unknown>
}

type KlingRefreshTaskInput = {
  taskID: string
  tasksPath?: string
}

type KlingCancelTaskInput = {
  taskID: string
}

type KlingClient = {
  createTask: (input: KlingCreateTaskInput) => Promise<unknown>
  refreshTask: (input: KlingRefreshTaskInput) => Promise<unknown>
  cancelTask?: (input: KlingCancelTaskInput) => Promise<unknown>
}

type KlingClientFactory = (apiKey: string) => KlingClient

const MOCK_PROVIDER_MANIFEST: CinemaVideoProviderManifest = {
  id: MOCK_PROVIDER_ID,
  name: "Mock Video",
  description: "Local mock provider for validating the Cinema task runtime.",
  requiresCredential: false,
  models: [
    {
      id: "mock-video",
      label: "Mock Video",
      modes: ["text-to-video", "image-to-video"],
      durations: [4, 8],
      aspectRatios: ["16:9", "9:16", "1:1"],
      resolutions: ["720p"],
      supportsSeed: true,
      supportsNegativePrompt: true,
      parameterSchema: {},
    },
  ],
}

const FAL_PROVIDER_MANIFEST: CinemaVideoProviderManifest = {
  id: FAL_PROVIDER_ID,
  name: "fal.ai",
  description: "Run fal.ai queued video generation models with a user-provided API key.",
  credentialProviderID: FAL_CREDENTIAL_PROVIDER_ID,
  requiresCredential: true,
  models: [
    {
      id: DEFAULT_FAL_MODEL_ID,
      label: "WAN 2.5 Text to Video",
      modes: ["text-to-video"],
      durations: [5, 10],
      aspectRatios: ["16:9", "9:16", "1:1"],
      resolutions: ["480p", "1080p"],
      supportsSeed: true,
      supportsNegativePrompt: true,
      supportsProviderUpload: true,
      parameterSchema: {},
    },
  ],
}

const KLING_PROVIDER_MANIFEST: CinemaVideoProviderManifest = {
  id: KLING_PROVIDER_ID,
  name: "Kling AI",
  description: "Run first-party Kling AI video generation models with a user-provided API key.",
  credentialProviderID: KLING_CREDENTIAL_PROVIDER_ID,
  requiresCredential: true,
  models: [
    {
      id: DEFAULT_KLING_MODEL_ID,
      label: "Kling 3.0 Turbo",
      modes: ["text-to-video", "image-to-video"],
      durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      aspectRatios: ["16:9", "9:16", "1:1"],
      resolutions: ["720p", "1080p"],
      requiresPublicInputURL: true,
      parameterSchema: {},
    },
  ],
}

const nowISO = () => new Date().toISOString()

let falClientFactory: FalClientFactory = (apiKey) => createFalClient({ credentials: apiKey })
let falApiKeyForTest: string | null = null
let klingClientFactory: KlingClientFactory = (apiKey) => createKlingClient({ apiKey })
let klingApiKeyForTest: string | null = null

export function setCinemaFalClientFactoryForTest(factory: FalClientFactory | null) {
  const previous = falClientFactory
  falClientFactory = factory ?? ((apiKey) => createFalClient({ credentials: apiKey }))
  return () => {
    falClientFactory = previous
  }
}

export function setCinemaKlingClientFactoryForTest(factory: KlingClientFactory | null) {
  const previous = klingClientFactory
  klingClientFactory = factory ?? ((apiKey) => createKlingClient({ apiKey }))
  return () => {
    klingClientFactory = previous
  }
}

export function setCinemaFalApiKeyForTest(apiKey: string | null) {
  const previous = falApiKeyForTest
  falApiKeyForTest = apiKey
  return () => {
    falApiKeyForTest = previous
  }
}

export function setCinemaKlingApiKeyForTest(apiKey: string | null) {
  const previous = klingApiKeyForTest
  klingApiKeyForTest = apiKey
  return () => {
    klingApiKeyForTest = previous
  }
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
  return (await providerAuthStateFor(FAL_PROVIDER_MANIFEST)).connected
    || (await providerAuthStateFor(KLING_PROVIDER_MANIFEST)).connected
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

function assertProviderModelSupports(input: CreateCinemaGenerationTaskBody, manifest: CinemaVideoProviderManifest) {
  const model = manifest.models.find((item) => item.id === input.modelID)
  if (!model) {
    throw new ApiError(400, "CINEMA_PROVIDER_MODEL_NOT_FOUND", `Cinema provider '${manifest.id}' does not expose model '${input.modelID}'.`)
  }
  if (!model.modes.includes(input.mode)) {
    throw new ApiError(400, "CINEMA_PROVIDER_MODE_UNSUPPORTED", `Model '${input.modelID}' does not support mode '${input.mode}'.`)
  }
}

function getProviderAdapter(providerID: string): ProviderAdapter {
  const adapter = providerAdapters[providerID]
  if (!adapter) {
    throw new ApiError(404, "CINEMA_PROVIDER_NOT_FOUND", `Cinema video provider '${providerID}' was not found.`)
  }
  return adapter
}

async function resolveFalApiKey() {
  if (falApiKeyForTest) return falApiKeyForTest
  const runtimeAuth = await ProviderAuth.resolveProviderRuntimeAuth(FAL_CREDENTIAL_PROVIDER_ID, {}, {
    method: "api-key",
    credentialMode: "active",
  })
  if (!runtimeAuth.apiKey) {
    throw new ApiError(400, "CINEMA_PROVIDER_NOT_CONNECTED", "fal.ai is not connected. Save a fal.ai API key before creating fal tasks.")
  }
  return runtimeAuth.apiKey
}

async function resolveKlingApiKey() {
  if (klingApiKeyForTest) return klingApiKeyForTest
  const runtimeAuth = await ProviderAuth.resolveProviderRuntimeAuth(KLING_CREDENTIAL_PROVIDER_ID, {}, {
    method: "api-key",
    credentialMode: "active",
  })
  if (!runtimeAuth.apiKey) {
    throw new ApiError(400, "CINEMA_PROVIDER_NOT_CONNECTED", "Kling AI is not connected. Save a Kling AI API key before creating Kling tasks.")
  }
  return runtimeAuth.apiKey
}

function klingPathFromEnv(name: string, fallback: string) {
  return getProcessEnvValue(name)?.trim() || fallback
}

function getKlingBaseURL() {
  return klingPathFromEnv("ANYBOX_KLING_BASE_URL", DEFAULT_KLING_BASE_URL)
}

function getKlingTextToVideoPath() {
  return klingPathFromEnv("ANYBOX_KLING_TEXT_TO_VIDEO_PATH", DEFAULT_KLING_TEXT_TO_VIDEO_PATH)
}

function getKlingImageToVideoPath() {
  return klingPathFromEnv("ANYBOX_KLING_IMAGE_TO_VIDEO_PATH", DEFAULT_KLING_IMAGE_TO_VIDEO_PATH)
}

function getKlingTasksPath() {
  return klingPathFromEnv("ANYBOX_KLING_TASKS_PATH", DEFAULT_KLING_TASKS_PATH)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function stringFromUnknown(value: unknown) {
  if (typeof value === "string") return value.trim() || undefined
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return undefined
}

function extractStringLikeDeep(value: unknown, keys: string[], seen = new Set<unknown>()): string | undefined {
  if (Array.isArray(value)) {
    if (seen.has(value)) return undefined
    seen.add(value)
    for (const item of value) {
      const found = extractStringLikeDeep(item, keys, seen)
      if (found) return found
    }
    return undefined
  }

  if (!isRecord(value)) return undefined
  if (seen.has(value)) return undefined
  seen.add(value)

  for (const key of keys) {
    const found = stringFromUnknown(value[key])
    if (found) return found
  }

  for (const item of Object.values(value)) {
    const found = extractStringLikeDeep(item, keys, seen)
    if (found) return found
  }
  return undefined
}

function readRecordString(record: Record<string, unknown>, key: string) {
  return stringFromUnknown(record[key])
}

function readKlingCode(value: unknown) {
  if (!isRecord(value)) return undefined
  const code = value.code
  return typeof code === "number" || typeof code === "string" ? code : undefined
}

function extractKlingError(value: unknown) {
  return extractStringLikeDeep(value, ["error", "message", "msg"])
}

function extractKlingRequestID(value: unknown) {
  return extractStringLikeDeep(value, ["request_id", "requestId"])
}

function extractKlingTaskID(value: unknown) {
  const data = isRecord(value) ? value.data : undefined
  return extractStringLikeDeep(data, ["id", "task_id", "taskId"])
    ?? extractStringLikeDeep(value, ["task_id", "taskId", "id"])
}

function extractKlingStatus(value: unknown) {
  return extractStringLikeDeep(value, ["status", "task_status", "taskStatus", "state"])
}

function createKlingClient({ apiKey, baseURL = getKlingBaseURL() }: { apiKey: string; baseURL?: string }): KlingClient {
  async function request(pathname: string, init: RequestInit = {}) {
    const url = new URL(pathname, baseURL)
    const headers = new Headers(init.headers)
    headers.set("authorization", `Bearer ${apiKey}`)
    if (!headers.has("content-type")) headers.set("content-type", "application/json")

    const response = await fetch(url, {
      ...init,
      headers,
    })
    const raw = await response.text()
    let payload: unknown = undefined
    if (raw.trim()) {
      try {
        payload = JSON.parse(raw)
      } catch {
        payload = raw
      }
    }

    if (!response.ok) {
      const providerMessage = extractKlingError(payload)
      throw new ApiError(
        502,
        "CINEMA_PROVIDER_REQUEST_FAILED",
        providerMessage
          ? `Kling AI request failed (${response.status}): ${providerMessage}`
          : `Kling AI request failed (${response.status}).`,
      )
    }

    const code = readKlingCode(payload)
    if (code !== undefined && String(code) !== "0") {
      throw new ApiError(502, "CINEMA_PROVIDER_REQUEST_FAILED", extractKlingError(payload) ?? "Kling AI returned an error.")
    }

    return payload
  }

  return {
    createTask: async ({ path: taskPathname, payload }) => {
      return await request(taskPathname, {
        method: "POST",
        body: JSON.stringify(payload),
      })
    },
    refreshTask: async ({ taskID, tasksPath }) => {
      const url = new URL(tasksPath ?? getKlingTasksPath(), baseURL)
      url.searchParams.set("task_ids", taskID)
      return await request(url.toString(), { method: "GET" })
    },
  }
}

function projectRelativePath(root: string, filePath: string) {
  return path.relative(root, filePath).split(path.sep).join("/")
}

function assertProjectRelativeFile(root: string, relativePath: string) {
  const resolved = path.resolve(root, relativePath)
  const normalizedRoot = path.resolve(root)
  const relative = path.relative(normalizedRoot, resolved)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ApiError(400, "CINEMA_ASSET_PATH_INVALID", "Cinema asset paths must stay inside the project folder.")
  }
  return resolved
}

function guessMimeType(filePath: string, contentType?: string | null) {
  if (contentType && contentType.trim()) return contentType.split(";")[0]!.trim()
  const ext = path.extname(filePath).toLowerCase()
  switch (ext) {
    case ".mp4":
      return "video/mp4"
    case ".webm":
      return "video/webm"
    case ".mov":
      return "video/quicktime"
    case ".png":
      return "image/png"
    case ".jpg":
    case ".jpeg":
      return "image/jpeg"
    case ".webp":
      return "image/webp"
    case ".mp3":
      return "audio/mpeg"
    case ".wav":
      return "audio/wav"
    default:
      return "application/octet-stream"
  }
}

function assetKindFromMime(mimeType: string): CinemaGeneratedAsset["kind"] {
  if (mimeType.startsWith("video/")) return "video"
  if (mimeType.startsWith("image/")) return "image"
  if (mimeType.startsWith("audio/")) return "audio"
  return "file"
}

function extensionForDownload(url: string, mimeType: string) {
  const pathname = new URL(url).pathname
  const ext = path.extname(pathname)
  if (ext && ext.length <= 8) return ext
  if (mimeType === "video/mp4") return ".mp4"
  if (mimeType === "video/webm") return ".webm"
  if (mimeType === "image/png") return ".png"
  if (mimeType === "image/jpeg") return ".jpg"
  if (mimeType === "image/webp") return ".webp"
  if (mimeType === "audio/mpeg") return ".mp3"
  if (mimeType === "audio/wav") return ".wav"
  return ".bin"
}

function collectMediaURLs(value: unknown, urls = new Set<string>()) {
  if (typeof value === "string") {
    try {
      const url = new URL(value)
      if (url.protocol === "http:" || url.protocol === "https:") urls.add(url.toString())
    } catch {
      // Not a URL.
    }
    return urls
  }
  if (Array.isArray(value)) {
    for (const item of value) collectMediaURLs(item, urls)
    return urls
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    if (typeof record.url === "string") collectMediaURLs(record.url, urls)
    for (const item of Object.values(record)) collectMediaURLs(item, urls)
  }
  return urls
}

async function downloadProviderOutputs(root: string, task: CinemaGenerationTask, payload: unknown) {
  const urls = [...collectMediaURLs(payload)].slice(0, 8)
  const outputDir = path.join(root, "generated", task.id)
  await mkdir(outputDir, { recursive: true })
  const assets: CinemaGeneratedAsset[] = []

  for (const [index, url] of urls.entries()) {
    const response = await fetch(url)
    if (!response.ok) {
      throw new ApiError(502, "CINEMA_PROVIDER_OUTPUT_DOWNLOAD_FAILED", `Could not download provider output (${response.status}).`)
    }
    const mimeType = guessMimeType(url, response.headers.get("content-type"))
    const filePath = path.join(outputDir, `output-${index + 1}${extensionForDownload(url, mimeType)}`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    await writeFile(filePath, bytes)
    assets.push({
      id: `asset-${task.id}-${index + 1}`,
      kind: assetKindFromMime(mimeType),
      path: projectRelativePath(root, filePath),
      mimeType,
      sizeBytes: bytes.byteLength,
      url,
    })
  }

  return assets
}

async function resolveSourceURLsForFal(
  root: string,
  client: Pick<FalClient, "storage">,
  task: CinemaGenerationTask,
  canvas: CinemaCanvasDocument,
) {
  const urls: string[] = []
  for (const nodeID of task.input.sourceNodeIDs) {
    const node = canvas.nodes.find((item) => item.id === nodeID)
    if (!node?.data) continue
    const url = typeof node.data.url === "string" ? node.data.url.trim() : ""
    if (url) {
      urls.push(url)
      continue
    }

    const relativePath = typeof node.data.path === "string" ? node.data.path.trim() : ""
    if (!relativePath) continue
    const filePath = assertProjectRelativeFile(root, relativePath)
    const bytes = await readFile(filePath)
    const blob = new Blob([bytes], { type: guessMimeType(filePath) })
    urls.push(await client.storage.upload(blob, { lifecycle: { expiresIn: "1d" } }))
  }
  return urls
}

async function buildFalInput(
  input: ProviderAdapterCreateInput,
  client: Pick<FalClient, "storage">,
) {
  const sourceURLs = await resolveSourceURLsForFal(input.root, client, input.task, input.canvas)
  const parameters = { ...input.task.input.parameters } as Record<string, unknown>
  if (!("prompt" in parameters)) parameters.prompt = input.task.input.prompt
  if (sourceURLs[0] && !("image_url" in parameters)) parameters.image_url = sourceURLs[0]
  if (sourceURLs.length > 1 && !("image_urls" in parameters)) parameters.image_urls = sourceURLs
  return parameters
}

const KLING_CONTROL_PARAMETER_KEYS = new Set([
  "endpointPath",
  "klingEndpointPath",
  "tasksPath",
  "klingTasksPath",
])

function splitKlingParameters(parameters: Record<string, unknown>) {
  const endpointPath = readRecordString(parameters, "endpointPath") ?? readRecordString(parameters, "klingEndpointPath")
  const tasksPath = readRecordString(parameters, "tasksPath") ?? readRecordString(parameters, "klingTasksPath")
  const cleanParameters: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(parameters)) {
    if (!KLING_CONTROL_PARAMETER_KEYS.has(key)) cleanParameters[key] = value
  }
  return {
    endpointPath,
    tasksPath,
    parameters: cleanParameters,
  }
}

function normalizeKlingGenerationParameters(parameters: Record<string, unknown>) {
  const payload = { ...parameters }
  const settings = isRecord(payload.settings) ? { ...payload.settings } : {}
  for (const key of ["duration", "aspect_ratio", "resolution"]) {
    if (key in payload && !(key in settings)) settings[key] = payload[key]
    delete payload[key]
  }
  if (Object.keys(settings).length > 0) payload.settings = settings

  const options = isRecord(payload.options) ? { ...payload.options } : {}
  for (const key of ["callback_url", "external_task_id", "watermark_info"]) {
    if (key in payload && !(key in options)) options[key] = payload[key]
    delete payload[key]
  }
  if (Object.keys(options).length > 0) payload.options = options

  return payload
}

function defaultKlingCreatePathForMode(mode: CinemaGenerationMode) {
  switch (mode) {
    case "text-to-video":
      return getKlingTextToVideoPath()
    case "image-to-video":
      return getKlingImageToVideoPath()
    default:
      throw new ApiError(400, "CINEMA_PROVIDER_MODE_UNSUPPORTED", `Kling AI does not support mode '${mode}' yet.`)
  }
}

function assertKlingPrompt(prompt: unknown, mode: CinemaGenerationMode) {
  if (typeof prompt === "string" && prompt.trim()) return
  if (mode === "text-to-video") {
    throw new ApiError(400, "CINEMA_PROMPT_REQUIRED", "Kling text-to-video requires a prompt.")
  }
}

function readKlingFirstFrameFromParameters(parameters: Record<string, unknown>) {
  return readRecordString(parameters, "first_frame_url")
    ?? readRecordString(parameters, "image_url")
    ?? readRecordString(parameters, "image")
    ?? readRecordString(parameters, "url")
}

function removeKlingSourceParameterAliases(payload: Record<string, unknown>) {
  delete payload.first_frame_url
  delete payload.image_url
  delete payload.image
  delete payload.url
}

function resolveSourceURLsForKling(
  root: string,
  task: CinemaGenerationTask,
  canvas: CinemaCanvasDocument,
) {
  const urls: string[] = []
  for (const nodeID of task.input.sourceNodeIDs) {
    const node = canvas.nodes.find((item) => item.id === nodeID)
    if (!node?.data) continue
    const url = typeof node.data.url === "string" ? node.data.url.trim() : ""
    if (url) {
      urls.push(url)
      continue
    }

    const relativePath = typeof node.data.path === "string" ? node.data.path.trim() : ""
    if (relativePath) {
      assertProjectRelativeFile(root, relativePath)
      throw new ApiError(
        400,
        "CINEMA_ASSET_PUBLIC_URL_REQUIRED",
        "Kling image-to-video currently requires source images to be public URLs or explicit base64/url parameters.",
      )
    }
  }
  return urls
}

async function buildKlingInput(input: ProviderAdapterCreateInput) {
  const split = splitKlingParameters(input.task.input.parameters)
  const createPath = split.endpointPath ?? defaultKlingCreatePathForMode(input.task.mode)
  const tasksPath = split.tasksPath ?? getKlingTasksPath()

  if (input.task.mode === "text-to-video") {
    const payload = normalizeKlingGenerationParameters(split.parameters)
    if (!("prompt" in payload)) payload.prompt = input.task.input.prompt
    assertKlingPrompt(payload.prompt, input.task.mode)
    return { createPath, tasksPath, payload }
  }

  if (input.task.mode === "image-to-video") {
    const firstFrame = resolveSourceURLsForKling(input.root, input.task, input.canvas)[0]
      ?? readKlingFirstFrameFromParameters(split.parameters)
    const prompt = readRecordString(split.parameters, "prompt") ?? input.task.input.prompt.trim()
    const payload = normalizeKlingGenerationParameters(split.parameters)
    removeKlingSourceParameterAliases(payload)
    delete payload.prompt

    if (!Array.isArray(payload.contents)) {
      if (!firstFrame) {
        throw new ApiError(
          400,
          "CINEMA_SOURCE_REQUIRED",
          "Kling image-to-video requires a first-frame image URL, source node URL, or base64/url parameter.",
        )
      }
      const contents: Array<Record<string, string>> = []
      if (prompt) contents.push({ type: "prompt", text: prompt })
      contents.push({ type: "first_frame", url: firstFrame })
      payload.contents = contents
    }

    return { createPath, tasksPath, payload }
  }

  throw new ApiError(400, "CINEMA_PROVIDER_MODE_UNSUPPORTED", `Kling AI does not support mode '${input.task.mode}' yet.`)
}

function mapKlingStatus(status: unknown): CinemaGenerationTaskStatus {
  const value = stringFromUnknown(status)?.toLowerCase()
  switch (value) {
    case "succeeded":
    case "success":
    case "completed":
    case "complete":
    case "done":
      return "succeeded"
    case "failed":
    case "failure":
    case "error":
      return "failed"
    case "canceled":
    case "cancelled":
      return "canceled"
    default:
      return "running"
  }
}

function klingTaskRecordID(value: unknown) {
  if (!isRecord(value)) return undefined
  return stringFromUnknown(value.id) ?? stringFromUnknown(value.task_id) ?? stringFromUnknown(value.taskId)
}

function readKlingTaskItems(value: unknown) {
  const data = isRecord(value) ? value.data : undefined
  if (Array.isArray(data)) return data
  if (isRecord(data)) {
    for (const key of ["tasks", "list", "items"]) {
      if (Array.isArray(data[key])) return data[key]
    }
  }
  if (isRecord(value)) {
    for (const key of ["tasks", "list", "items"]) {
      if (Array.isArray(value[key])) return value[key]
    }
  }
  return undefined
}

function resolveKlingTaskRecord(value: unknown, taskID: string) {
  const items = readKlingTaskItems(value)
  if (items) return items.find((item) => klingTaskRecordID(item) === taskID) ?? items[0]
  const data = isRecord(value) ? value.data : undefined
  return isRecord(data) ? data : value
}

function klingOutputPayloadFromTaskRecord(taskRecord: unknown) {
  if (!isRecord(taskRecord)) return taskRecord
  for (const key of ["result", "output", "outputs", "video", "videos"]) {
    if (key in taskRecord) return taskRecord[key]
  }
  return taskRecord
}

async function createMockOutput(root: string, task: CinemaGenerationTask) {
  const outputDir = path.join(root, "generated", task.id)
  await mkdir(outputDir, { recursive: true })
  const filePath = path.join(outputDir, "mock-output.mp4")
  await writeFile(
    filePath,
    `Mock Cinema output for ${task.title}\n\nPrompt:\n${task.input.prompt}\n`,
    "utf8",
  )
  const size = await stat(filePath)
  return [{
    id: `asset-${task.id}-1`,
    kind: "video" as const,
    path: projectRelativePath(root, filePath),
    mimeType: "video/mp4",
    sizeBytes: size.size,
  }]
}

const mockProviderAdapter: ProviderAdapter = {
  manifest: MOCK_PROVIDER_MANIFEST,
  async createTask({ task }) {
    return {
      ...task,
      status: "running",
      updatedAt: nowISO(),
      providerTaskRef: {
        mock: true,
      },
    }
  },
  async refreshTask({ root, task }) {
    if (isFinalTaskStatus(task.status)) return task
    const outputAssets = await createMockOutput(root, task)
    return {
      ...task,
      status: "succeeded",
      updatedAt: nowISO(),
      outputAssets,
      error: null,
    }
  },
  async cancelTask({ task }) {
    if (isFinalTaskStatus(task.status)) return task
    return {
      ...task,
      status: "canceled",
      updatedAt: nowISO(),
    }
  },
}

const falProviderAdapter: ProviderAdapter = {
  manifest: FAL_PROVIDER_MANIFEST,
  async createTask(input) {
    const apiKey = await resolveFalApiKey()
    const client = falClientFactory(apiKey)
    const falInput = await buildFalInput(input, client)
    const result = await client.queue.submit(input.task.modelID as never, {
      input: falInput as never,
    })
    return {
      ...input.task,
      status: "running",
      updatedAt: nowISO(),
      providerTaskRef: {
        endpointID: input.task.modelID,
        requestID: result.request_id,
      },
    }
  },
  async refreshTask({ root, task }) {
    if (isFinalTaskStatus(task.status)) return task
    const apiKey = await resolveFalApiKey()
    const client = falClientFactory(apiKey)
    const endpointID = typeof task.providerTaskRef?.endpointID === "string" ? task.providerTaskRef.endpointID : task.modelID
    const requestID = typeof task.providerTaskRef?.requestID === "string" ? task.providerTaskRef.requestID : ""
    if (!requestID) {
      throw new ApiError(409, "CINEMA_PROVIDER_TASK_REF_MISSING", `Cinema task '${task.id}' is missing a fal request ID.`)
    }

    const status = await client.queue.status(endpointID, { requestId: requestID, logs: true })
    if (status.status !== "COMPLETED") {
      return {
        ...task,
        status: "running",
        updatedAt: nowISO(),
        providerTaskRef: {
          ...task.providerTaskRef,
          falStatus: status.status,
          queuePosition: "queue_position" in status ? status.queue_position : undefined,
        },
      }
    }

    const result = await client.queue.result(endpointID as never, { requestId: requestID })
    const outputAssets = await downloadProviderOutputs(root, task, result.data)
    return {
      ...task,
      status: "succeeded",
      updatedAt: nowISO(),
      providerTaskRef: {
        ...task.providerTaskRef,
        falStatus: status.status,
      },
      outputAssets,
      error: null,
    }
  },
  async cancelTask({ task }) {
    if (isFinalTaskStatus(task.status)) return task
    const apiKey = await resolveFalApiKey()
    const client = falClientFactory(apiKey)
    const endpointID = typeof task.providerTaskRef?.endpointID === "string" ? task.providerTaskRef.endpointID : task.modelID
    const requestID = typeof task.providerTaskRef?.requestID === "string" ? task.providerTaskRef.requestID : ""
    if (requestID) await client.queue.cancel(endpointID, { requestId: requestID })
    return {
      ...task,
      status: "canceled",
      updatedAt: nowISO(),
    }
  },
}

const klingProviderAdapter: ProviderAdapter = {
  manifest: KLING_PROVIDER_MANIFEST,
  async createTask(input) {
    const apiKey = await resolveKlingApiKey()
    const client = klingClientFactory(apiKey)
    const klingInput = await buildKlingInput(input)
    const result = await client.createTask({
      mode: input.task.mode,
      path: klingInput.createPath,
      payload: klingInput.payload,
    })
    const taskID = extractKlingTaskID(result)
    if (!taskID) {
      throw new ApiError(502, "CINEMA_PROVIDER_TASK_REF_MISSING", "Kling AI did not return a task ID.")
    }
    const taskRecord = resolveKlingTaskRecord(result, taskID)

    return {
      ...input.task,
      status: "running",
      updatedAt: nowISO(),
      providerTaskRef: {
        taskID,
        requestID: extractKlingRequestID(result),
        createPath: klingInput.createPath,
        tasksPath: klingInput.tasksPath,
        klingStatus: extractKlingStatus(taskRecord) ?? extractKlingStatus(result),
      },
    }
  },
  async refreshTask({ root, task }) {
    if (isFinalTaskStatus(task.status)) return task
    const apiKey = await resolveKlingApiKey()
    const client = klingClientFactory(apiKey)
    const taskID = typeof task.providerTaskRef?.taskID === "string" ? task.providerTaskRef.taskID : ""
    if (!taskID) {
      throw new ApiError(409, "CINEMA_PROVIDER_TASK_REF_MISSING", `Cinema task '${task.id}' is missing a Kling task ID.`)
    }
    const tasksPath = typeof task.providerTaskRef?.tasksPath === "string" ? task.providerTaskRef.tasksPath : getKlingTasksPath()
    const result = await client.refreshTask({ taskID, tasksPath })
    const taskRecord = resolveKlingTaskRecord(result, taskID)
    const klingStatus = extractKlingStatus(taskRecord) ?? extractKlingStatus(result)
    const status = mapKlingStatus(klingStatus)

    if (status === "succeeded") {
      const outputAssets = await downloadProviderOutputs(root, task, klingOutputPayloadFromTaskRecord(taskRecord))
      return {
        ...task,
        status: "succeeded",
        updatedAt: nowISO(),
        providerTaskRef: {
          ...task.providerTaskRef,
          klingStatus,
        },
        outputAssets,
        error: null,
      }
    }

    if (status === "failed" || status === "canceled") {
      return {
        ...task,
        status,
        updatedAt: nowISO(),
        providerTaskRef: {
          ...task.providerTaskRef,
          klingStatus,
        },
        error: status === "failed" ? extractKlingError(taskRecord) ?? extractKlingError(result) ?? "Kling AI task failed." : task.error,
      }
    }

    return {
      ...task,
      status: "running",
      updatedAt: nowISO(),
      providerTaskRef: {
        ...task.providerTaskRef,
        klingStatus,
      },
    }
  },
  async cancelTask({ task }) {
    if (isFinalTaskStatus(task.status)) return task
    const apiKey = await resolveKlingApiKey()
    const client = klingClientFactory(apiKey)
    const taskID = typeof task.providerTaskRef?.taskID === "string" ? task.providerTaskRef.taskID : ""
    if (taskID && client.cancelTask) await client.cancelTask({ taskID })
    return {
      ...task,
      status: "canceled",
      updatedAt: nowISO(),
    }
  },
}

const providerAdapters: Record<string, ProviderAdapter> = {
  [MOCK_PROVIDER_ID]: mockProviderAdapter,
  [FAL_PROVIDER_ID]: falProviderAdapter,
  [KLING_PROVIDER_ID]: klingProviderAdapter,
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

async function videoProviderFor(adapter: ProviderAdapter): Promise<CinemaVideoProvider> {
  return {
    manifest: adapter.manifest,
    auth: await providerAuthStateFor(adapter.manifest),
  }
}

export async function listCinemaVideoProviders(): Promise<CinemaVideoProvider[]> {
  return await Promise.all(Object.values(providerAdapters).map(videoProviderFor))
}

export async function getCinemaVideoProvider(providerID: string): Promise<CinemaVideoProvider> {
  return await videoProviderFor(getProviderAdapter(providerID))
}

export async function getCinemaVideoProviderAuth(providerID: string): Promise<CinemaProviderAuthState> {
  return (await getCinemaVideoProvider(providerID)).auth
}

export async function saveCinemaVideoProviderApiKey(providerID: string, apiKey: string | null | undefined): Promise<CinemaProviderAuthState> {
  const adapter = getProviderAdapter(providerID)
  if (!adapter.manifest.requiresCredential || !adapter.manifest.credentialProviderID) {
    throw new ApiError(400, "CINEMA_PROVIDER_CREDENTIAL_UNSUPPORTED", `Cinema provider '${providerID}' does not use API key credentials.`)
  }
  await ProviderAuth.saveProviderApiKey(adapter.manifest.credentialProviderID, apiKey)
  return await providerAuthStateFor(adapter.manifest)
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
  const adapter = getProviderAdapter(input.providerID)
  assertProviderModelSupports(input, adapter.manifest)

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
  const adapter = getProviderAdapter(task.providerID)
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
  const adapter = getProviderAdapter(task.providerID)
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
