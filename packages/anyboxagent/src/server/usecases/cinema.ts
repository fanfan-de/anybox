import { randomUUID } from "node:crypto"
import { appendFile, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import {
  CinemaCanvasDocumentSchema,
  CinemaGenerationTaskSchema,
  CinemaProjectEventSchema,
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
} from "@anybox/shared/cinema"
import { isSshWorkspaceUri } from "@anybox/shared"
import * as CinemaProviderRuntime from "#cinema/provider-runtime.ts"
import * as Project from "#project/project.ts"
import { ApiError } from "#server/error.ts"
import { getServerBaseURL } from "#server/base-url.ts"
import { getProcessEnvValue } from "#env/compat.ts"

export {
  setCinemaFalApiKeyForTest,
  setCinemaFalClientFactoryForTest,
  setCinemaKlingApiKeyForTest,
  setCinemaKlingClientFactoryForTest,
} from "#cinema/provider-runtime.ts"

const CINEMA_DIRECTORY = ".anybox-cinema"
const CANVAS_FILE = "canvas.json"
const PROJECT_FILE = "project.json"
const EVENTS_FILE = "events.jsonl"
const PROVIDERS_FILE = "providers.json"
const TASKS_FILE = "tasks.jsonl"
const TASKS_DIRECTORY = "tasks"
const PROJECT_DIRECTORIES = ["assets", "references", "prompts", "generated", "renders", "exports"] as const

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
export const getCinemaVideoProvider = CinemaProviderRuntime.getCinemaVideoProvider
export const getCinemaVideoProviderAuth = CinemaProviderRuntime.getCinemaVideoProviderAuth
export const saveCinemaVideoProviderApiKey = CinemaProviderRuntime.saveCinemaVideoProviderApiKey

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
  const adapter = CinemaProviderRuntime.getCinemaVideoProviderAdapter(input.providerID)
  CinemaProviderRuntime.assertCinemaVideoProviderModelSupports(input, adapter.manifest)

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
