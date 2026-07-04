import { appendFile, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import {
  CinemaCanvasDocumentSchema,
  CinemaProjectEventSchema,
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
} from "@anybox/shared/cinema"
import { isSshWorkspaceUri } from "@anybox/shared"
import * as Project from "#project/project.ts"
import { ApiError } from "#server/error.ts"
import { getServerBaseURL } from "#server/base-url.ts"
import { getProcessEnvValue } from "#env/compat.ts"

const CINEMA_DIRECTORY = ".anybox-cinema"
const CANVAS_FILE = "canvas.json"
const PROJECT_FILE = "project.json"
const EVENTS_FILE = "events.jsonl"
const PROVIDERS_FILE = "providers.json"
const PROJECT_DIRECTORIES = ["assets", "references", "prompts", "generated", "renders", "exports"] as const

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

async function appendCinemaEvent(cinemaRoot: string, event: CinemaProjectEvent) {
  const parsed = CinemaProjectEventSchema.parse(event)
  await appendFile(path.join(cinemaRoot, EVENTS_FILE), `${JSON.stringify(parsed)}\n`, "utf8")
  return parsed
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
  return Array.isArray(providers?.providers) && providers.providers.length > 0
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
