#!/usr/bin/env node

const fs = require("node:fs/promises")
const path = require("node:path")
const readline = require("node:readline")

const CINEMA_DIRECTORY = ".anybox-cinema"
const CANVAS_FILE = "canvas.json"
const PROJECT_FILE = "project.json"
const EVENTS_FILE = "events.jsonl"
const PROVIDERS_FILE = "providers.json"
const PROJECT_DIRECTORIES = ["assets", "references", "prompts", "generated", "renders", "exports"]
const NODE_TYPES = new Set([
  "text",
  "prompt",
  "image",
  "video",
  "audio",
  "shot",
  "agent",
  "generation-task",
  "output"
])

const projectRootSchema = {
  type: "string",
  minLength: 1,
  description: "Absolute local folder path for the initialized anybox for cinema project."
}

const positionSchema = {
  type: "object",
  properties: {
    x: { type: "number" },
    y: { type: "number" }
  },
  required: ["x", "y"],
  additionalProperties: false
}

const sizeSchema = {
  type: "object",
  properties: {
    width: { type: "number", exclusiveMinimum: 0 },
    height: { type: "number", exclusiveMinimum: 0 }
  },
  required: ["width", "height"],
  additionalProperties: false
}

const canvasNodeSchema = {
  type: "object",
  properties: {
    id: { type: "string", minLength: 1 },
    type: {
      type: "string",
      enum: [...NODE_TYPES]
    },
    title: { type: "string", minLength: 1 },
    position: positionSchema,
    size: sizeSchema,
    data: {
      type: "object",
      additionalProperties: true
    }
  },
  required: ["id", "type", "title", "position"],
  additionalProperties: false
}

const canvasEdgeSchema = {
  type: "object",
  properties: {
    id: { type: "string", minLength: 1 },
    source: { type: "string", minLength: 1 },
    target: { type: "string", minLength: 1 },
    sourceHandle: { type: "string", minLength: 1 },
    targetHandle: { type: "string", minLength: 1 },
    label: { type: "string" },
    data: {
      type: "object",
      additionalProperties: true
    }
  },
  required: ["id", "source", "target"],
  additionalProperties: false
}

const commandSchema = {
  type: "object",
  properties: {
    id: { type: "string", minLength: 1 },
    actor: { type: "string", minLength: 1 },
    type: {
      type: "string",
      enum: [
        "create-node",
        "update-node",
        "delete-node",
        "connect-nodes",
        "disconnect-edge",
        "update-viewport",
        "create-generation-task",
        "complete-generation-task"
      ]
    },
    node: canvasNodeSchema,
    nodeID: { type: "string", minLength: 1 },
    patch: {
      type: "object",
      properties: {
        type: { type: "string", enum: [...NODE_TYPES] },
        title: { type: "string", minLength: 1 },
        position: positionSchema,
        size: sizeSchema,
        data: {
          type: "object",
          additionalProperties: true
        }
      },
      additionalProperties: false
    },
    edge: canvasEdgeSchema,
    edgeID: { type: "string", minLength: 1 },
    viewport: {
      type: "object",
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        zoom: { type: "number", exclusiveMinimum: 0 }
      },
      required: ["x", "y", "zoom"],
      additionalProperties: false
    },
    taskNodeID: { type: "string", minLength: 1 },
    outputNode: canvasNodeSchema
  },
  required: ["type"],
  additionalProperties: false
}

const tools = [
  {
    name: "cinema_get_project_summary",
    title: "Get Cinema Project Summary",
    description: "Read an initialized Cinema project's local files, canvas summary, recent events, directory overview, and gaps.",
    inputSchema: {
      type: "object",
      properties: {
        projectRoot: projectRootSchema,
        projectID: {
          type: "string",
          minLength: 1,
          description: "Optional legacy label used only in returned metadata. This tool reads projectRoot directly."
        }
      },
      required: ["projectRoot"],
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true
    }
  },
  {
    name: "cinema_apply_command",
    title: "Apply Cinema Command",
    description: "Apply a Cinema canvas command directly to .anybox-cinema/canvas.json and append a local event.",
    inputSchema: {
      type: "object",
      properties: {
        projectRoot: projectRootSchema,
        projectID: {
          type: "string",
          minLength: 1,
          description: "Optional legacy label used only in returned metadata. This tool reads projectRoot directly."
        },
        command: commandSchema
      },
      required: ["projectRoot", "command"],
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false
    }
  },
  {
    name: "cinema_create_shot_plan",
    title: "Create Cinema Shot Plan",
    description: "Create Shot and Prompt nodes in local .anybox-cinema/canvas.json and append command events.",
    inputSchema: {
      type: "object",
      properties: {
        projectRoot: projectRootSchema,
        projectID: {
          type: "string",
          minLength: 1,
          description: "Optional legacy label used only in returned metadata. This tool reads projectRoot directly."
        },
        storyNodeID: {
          type: "string",
          minLength: 1,
          description: "Optional source Text node id to connect into each Shot. Defaults to the first text node in the summary when available."
        },
        origin: {
          type: "object",
          properties: {
            x: { type: "number" },
            y: { type: "number" }
          },
          additionalProperties: false,
          description: "Optional starting canvas position. Defaults to x=160, y=160."
        },
        shots: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              title: { type: "string", minLength: 1 },
              text: { type: "string", description: "Shot description, duration, and visual intent." },
              prompt: { type: "string", description: "Optional generation prompt for this shot." }
            },
            required: ["title"],
            additionalProperties: false
          }
        }
      },
      required: ["projectRoot", "shots"],
      additionalProperties: false
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false
    }
  }
]

function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

function textResult(text, structuredContent) {
  return {
    content: [{ type: "text", text }],
    structuredContent,
    isError: false
  }
}

function errorResult(error) {
  const message = error && typeof error.message === "string" ? error.message : String(error)
  const code = error && typeof error.code === "string" ? error.code : "CINEMA_PLUGIN_ERROR"
  const status = error && Number.isInteger(error.status) ? error.status : undefined

  return {
    content: [{ type: "text", text: message }],
    structuredContent: {
      kind: "cinema_error",
      error: { code, message, status }
    },
    isError: true
  }
}

function pluginError(code, message, status) {
  const error = new Error(message)
  error.code = code
  if (Number.isInteger(status)) error.status = status
  return error
}

function makeID(prefix, index) {
  const stamp = Date.now().toString(36)
  const suffix = Math.random().toString(36).slice(2, 7)
  return `${prefix}-${stamp}-${index}-${suffix}`
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function assertPlainObject(value, label) {
  if (!isPlainObject(value)) {
    throw pluginError("CINEMA_INVALID_INPUT", `${label} must be an object.`, 400)
  }
}

function assertString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw pluginError("CINEMA_INVALID_INPUT", `${label} must be a non-empty string.`, 400)
  }
  return value
}

function assertNumber(value, label) {
  if (!Number.isFinite(value)) {
    throw pluginError("CINEMA_INVALID_INPUT", `${label} must be a finite number.`, 400)
  }
  return value
}

function assertPositiveNumber(value, label) {
  assertNumber(value, label)
  if (value <= 0) {
    throw pluginError("CINEMA_INVALID_INPUT", `${label} must be greater than 0.`, 400)
  }
  return value
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  )
}

function projectRootFromArgs(args) {
  const rawRoot = args && args.projectRoot ? args.projectRoot : process.env.ANYBOX_CINEMA_PROJECT_ROOT
  const root = assertString(rawRoot, "projectRoot").trim()
  if (!path.isAbsolute(root)) {
    throw pluginError("CINEMA_INVALID_INPUT", "projectRoot must be an absolute local folder path.", 400)
  }
  return path.resolve(root)
}

function cinemaRootForProject(root) {
  return path.join(root, CINEMA_DIRECTORY)
}

async function assertProjectRootDirectory(root) {
  const stats = await fs.stat(root).catch((error) => {
    if (error && error.code === "ENOENT") {
      throw pluginError("CINEMA_PROJECT_ROOT_NOT_FOUND", `Project root '${root}' does not exist.`, 404)
    }
    throw error
  })
  if (!stats.isDirectory()) {
    throw pluginError("CINEMA_INVALID_INPUT", `Project root '${root}' is not a directory.`, 400)
  }
}

async function pathExists(filePath) {
  return await fs.stat(filePath)
    .then(() => true)
    .catch((error) => {
      if (error && error.code === "ENOENT") return false
      throw error
    })
}

async function readOptionalJson(filePath, fileLabel) {
  const raw = await fs.readFile(filePath, "utf8").catch((error) => {
    if (error && error.code === "ENOENT") return null
    throw error
  })
  if (raw === null) return undefined
  try {
    return JSON.parse(raw)
  } catch (error) {
    throw createInvalidJsonError(fileLabel, error)
  }
}

function createInvalidJsonError(fileLabel, error) {
  const detail = error instanceof Error && error.message.trim() ? error.message : "Invalid JSON"
  return pluginError("CINEMA_METADATA_INVALID", `${fileLabel} is invalid: ${detail}`, 409)
}

async function assertCinemaProjectInitialized(cinemaRoot) {
  if (!(await pathExists(path.join(cinemaRoot, PROJECT_FILE)))) {
    throw pluginError(
      "CINEMA_PROJECT_NOT_INITIALIZED",
      "This folder has not been initialized for anybox for cinema yet.",
      404
    )
  }
}

function normalizePosition(value, label) {
  assertPlainObject(value, label)
  return {
    x: assertNumber(value.x, `${label}.x`),
    y: assertNumber(value.y, `${label}.y`)
  }
}

function normalizeSize(value, label) {
  assertPlainObject(value, label)
  return {
    width: assertPositiveNumber(value.width, `${label}.width`),
    height: assertPositiveNumber(value.height, `${label}.height`)
  }
}

function normalizeViewport(value, label) {
  assertPlainObject(value, label)
  return {
    x: assertNumber(value.x, `${label}.x`),
    y: assertNumber(value.y, `${label}.y`),
    zoom: assertPositiveNumber(value.zoom, `${label}.zoom`)
  }
}

function normalizeNode(value, label) {
  assertPlainObject(value, label)
  const type = assertString(value.type, `${label}.type`)
  if (!NODE_TYPES.has(type)) {
    throw pluginError("CINEMA_INVALID_INPUT", `${label}.type '${type}' is not supported.`, 400)
  }

  return compactObject({
    id: assertString(value.id, `${label}.id`),
    type,
    title: assertString(value.title, `${label}.title`),
    position: normalizePosition(value.position, `${label}.position`),
    size: value.size === undefined ? undefined : normalizeSize(value.size, `${label}.size`),
    data: value.data === undefined ? undefined : cloneJson(assertDataObject(value.data, `${label}.data`))
  })
}

function normalizeEdge(value, label) {
  assertPlainObject(value, label)
  return compactObject({
    id: assertString(value.id, `${label}.id`),
    source: assertString(value.source, `${label}.source`),
    target: assertString(value.target, `${label}.target`),
    sourceHandle: value.sourceHandle === undefined ? undefined : assertString(value.sourceHandle, `${label}.sourceHandle`),
    targetHandle: value.targetHandle === undefined ? undefined : assertString(value.targetHandle, `${label}.targetHandle`),
    label: value.label === undefined ? undefined : String(value.label),
    data: value.data === undefined ? undefined : cloneJson(assertDataObject(value.data, `${label}.data`))
  })
}

function assertDataObject(value, label) {
  assertPlainObject(value, label)
  return value
}

function normalizeNodePatch(value) {
  assertPlainObject(value, "command.patch")
  const patch = {}
  if (value.type !== undefined) {
    const type = assertString(value.type, "command.patch.type")
    if (!NODE_TYPES.has(type)) {
      throw pluginError("CINEMA_INVALID_INPUT", `command.patch.type '${type}' is not supported.`, 400)
    }
    patch.type = type
  }
  if (value.title !== undefined) patch.title = assertString(value.title, "command.patch.title")
  if (value.position !== undefined) patch.position = normalizePosition(value.position, "command.patch.position")
  if (value.size !== undefined) patch.size = normalizeSize(value.size, "command.patch.size")
  if (value.data !== undefined) patch.data = cloneJson(assertDataObject(value.data, "command.patch.data"))
  if (Object.keys(patch).length === 0) {
    throw pluginError("CINEMA_INVALID_INPUT", "command.patch must include at least one field.", 400)
  }
  return patch
}

function normalizeCanvas(value, fileLabel) {
  assertPlainObject(value, fileLabel)
  const nodes = Array.isArray(value.nodes) ? value.nodes : []
  const edges = Array.isArray(value.edges) ? value.edges : []
  const nodeTypes = Array.isArray(value.nodeTypes) ? value.nodeTypes : []

  if (value.schemaVersion !== 1) {
    throw pluginError("CINEMA_METADATA_INVALID", `${fileLabel}.schemaVersion must be 1.`, 409)
  }
  if (value.canvasType !== "node-canvas") {
    throw pluginError("CINEMA_METADATA_INVALID", `${fileLabel}.canvasType must be node-canvas.`, 409)
  }

  return {
    schemaVersion: 1,
    canvasType: "node-canvas",
    viewport: normalizeViewport(value.viewport, `${fileLabel}.viewport`),
    nodes: nodes.map((node, index) => normalizeNode(node, `${fileLabel}.nodes[${index}]`)),
    edges: edges.map((edge, index) => normalizeEdge(edge, `${fileLabel}.edges[${index}]`)),
    nodeTypes: nodeTypes.map((type, index) => {
      const normalized = assertString(type, `${fileLabel}.nodeTypes[${index}]`)
      if (!NODE_TYPES.has(normalized)) {
        throw pluginError("CINEMA_METADATA_INVALID", `${fileLabel}.nodeTypes[${index}] '${normalized}' is not supported.`, 409)
      }
      return normalized
    })
  }
}

function normalizeCommand(value) {
  assertPlainObject(value, "command")
  const type = assertString(value.type, "command.type")
  const base = compactObject({
    id: value.id === undefined ? undefined : assertString(value.id, "command.id"),
    actor: value.actor === undefined ? undefined : assertString(value.actor, "command.actor"),
    type
  })

  switch (type) {
    case "create-node":
      return { ...base, node: normalizeNode(value.node, "command.node") }
    case "update-node":
      return {
        ...base,
        nodeID: assertString(value.nodeID, "command.nodeID"),
        patch: normalizeNodePatch(value.patch)
      }
    case "delete-node":
      return { ...base, nodeID: assertString(value.nodeID, "command.nodeID") }
    case "connect-nodes":
      return { ...base, edge: normalizeEdge(value.edge, "command.edge") }
    case "disconnect-edge":
      return { ...base, edgeID: assertString(value.edgeID, "command.edgeID") }
    case "update-viewport":
      return { ...base, viewport: normalizeViewport(value.viewport, "command.viewport") }
    case "create-generation-task": {
      const node = normalizeNode(value.node, "command.node")
      if (node.type !== "generation-task") {
        throw pluginError("CINEMA_INVALID_INPUT", "command.node.type must be generation-task.", 400)
      }
      return { ...base, node }
    }
    case "complete-generation-task":
      return compactObject({
        ...base,
        taskNodeID: assertString(value.taskNodeID, "command.taskNodeID"),
        outputNode: value.outputNode === undefined ? undefined : normalizeNode(value.outputNode, "command.outputNode")
      })
    default:
      throw pluginError("CINEMA_INVALID_INPUT", `Unsupported Cinema command type '${type}'.`, 400)
  }
}

async function readCinemaCanvas(cinemaRoot) {
  const canvasPath = path.join(cinemaRoot, CANVAS_FILE)
  const raw = await fs.readFile(canvasPath, "utf8").catch((error) => {
    if (error && error.code === "ENOENT") {
      throw pluginError(
        "CINEMA_PROJECT_NOT_INITIALIZED",
        "This folder is missing .anybox-cinema/canvas.json.",
        404
      )
    }
    throw error
  })

  try {
    return normalizeCanvas(JSON.parse(raw), CANVAS_FILE)
  } catch (error) {
    if (error && error.code) throw error
    throw createInvalidJsonError(CANVAS_FILE, error)
  }
}

async function writeCinemaCanvas(cinemaRoot, canvas) {
  const parsed = normalizeCanvas(canvas, CANVAS_FILE)
  await fs.mkdir(cinemaRoot, { recursive: true })
  const canvasPath = path.join(cinemaRoot, CANVAS_FILE)
  const tempPath = path.join(cinemaRoot, `${CANVAS_FILE}.${process.pid}.${Date.now()}.tmp`)
  await fs.writeFile(tempPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8")
  await fs.rename(tempPath, canvasPath)
  return parsed
}

async function appendCinemaEvent(cinemaRoot, event) {
  const parsed = {
    time: assertString(event.time, "event.time"),
    type: assertString(event.type, "event.type"),
    actor: assertString(event.actor, "event.actor"),
    message: assertString(event.message, "event.message"),
    ...(event.commandID ? { commandID: assertString(event.commandID, "event.commandID") } : {}),
    ...(event.data === undefined ? {} : { data: cloneJson(assertDataObject(event.data, "event.data")) })
  }
  await fs.appendFile(path.join(cinemaRoot, EVENTS_FILE), `${JSON.stringify(parsed)}\n`, "utf8")
  return parsed
}

function assertCanvasHasNode(canvas, nodeID) {
  if (!canvas.nodes.some((node) => node.id === nodeID)) {
    throw pluginError("CINEMA_NODE_NOT_FOUND", `Cinema node '${nodeID}' was not found.`, 404)
  }
}

function withNodeTypes(canvas) {
  const nodeTypes = new Set(canvas.nodeTypes)
  for (const node of canvas.nodes) nodeTypes.add(node.type)
  return {
    ...canvas,
    nodeTypes: [...nodeTypes]
  }
}

function appendNode(canvas, node) {
  if (canvas.nodes.some((current) => current.id === node.id)) {
    throw pluginError("CINEMA_COMMAND_INVALID", `Cinema node '${node.id}' already exists.`, 409)
  }

  return withNodeTypes({
    ...canvas,
    nodes: [...canvas.nodes, node]
  })
}

function describeCinemaCommand(command) {
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
    default:
      return `Applied Cinema command '${command.type}'.`
  }
}

function applyCommandToCanvas(canvas, command) {
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
              data: command.patch.data ?? node.data
            }
            : node
        )
      })
    }
    case "delete-node": {
      assertCanvasHasNode(canvas, command.nodeID)
      return {
        ...canvas,
        nodes: canvas.nodes.filter((node) => node.id !== command.nodeID),
        edges: canvas.edges.filter((edge) => edge.source !== command.nodeID && edge.target !== command.nodeID)
      }
    }
    case "connect-nodes": {
      assertCanvasHasNode(canvas, command.edge.source)
      assertCanvasHasNode(canvas, command.edge.target)
      if (canvas.edges.some((edge) => edge.id === command.edge.id)) {
        throw pluginError("CINEMA_COMMAND_INVALID", `Cinema edge '${command.edge.id}' already exists.`, 409)
      }
      return {
        ...canvas,
        edges: [...canvas.edges, command.edge]
      }
    }
    case "disconnect-edge":
      return {
        ...canvas,
        edges: canvas.edges.filter((edge) => edge.id !== command.edgeID)
      }
    case "update-viewport":
      return {
        ...canvas,
        viewport: command.viewport
      }
    case "create-generation-task":
      return appendNode(canvas, {
        ...command.node,
        data: {
          status: "queued",
          ...command.node.data
        }
      })
    case "complete-generation-task": {
      const taskNode = canvas.nodes.find((node) => node.id === command.taskNodeID)
      if (!taskNode) {
        throw pluginError("CINEMA_NODE_NOT_FOUND", `Cinema node '${command.taskNodeID}' was not found.`, 404)
      }
      if (taskNode.type !== "generation-task") {
        throw pluginError("CINEMA_COMMAND_INVALID", `Cinema node '${command.taskNodeID}' is not a generation task.`, 409)
      }

      let next = withNodeTypes({
        ...canvas,
        nodes: canvas.nodes.map((node) =>
          node.id === command.taskNodeID
            ? {
              ...node,
              data: {
                ...node.data,
                status: "completed"
              }
            }
            : node
        )
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
                target: command.outputNode.id
              }
            ]
          }
        }
      }

      return next
    }
    default:
      throw pluginError("CINEMA_INVALID_INPUT", `Unsupported Cinema command type '${command.type}'.`, 400)
  }
}

async function applyProjectCommand(root, command) {
  await assertProjectRootDirectory(root)
  const cinemaRoot = cinemaRootForProject(root)
  await assertCinemaProjectInitialized(cinemaRoot)
  const normalizedCommand = normalizeCommand({
    actor: "cinema-plugin",
    ...command
  })
  const current = await readCinemaCanvas(cinemaRoot)
  const next = applyCommandToCanvas(current, normalizedCommand)
  const canvas = await writeCinemaCanvas(cinemaRoot, next)
  const event = await appendCinemaEvent(cinemaRoot, {
    time: new Date().toISOString(),
    type: `command.${normalizedCommand.type}`,
    actor: normalizedCommand.actor ?? "cinema-plugin",
    message: describeCinemaCommand(normalizedCommand),
    ...(normalizedCommand.id ? { commandID: normalizedCommand.id } : {}),
    data: { command: normalizedCommand }
  })

  return { canvas, event, command: normalizedCommand }
}

async function readCinemaEvents(cinemaRoot, options = {}) {
  const raw = await fs.readFile(path.join(cinemaRoot, EVENTS_FILE), "utf8").catch((error) => {
    if (error && error.code === "ENOENT") return ""
    throw error
  })
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0)
  const limit = Number.isInteger(options.limit) ? options.limit : 50
  const start = Number.isInteger(options.after) ? options.after : Math.max(0, lines.length - limit)
  const selected = lines.slice(start, start + limit)

  try {
    return {
      events: selected.map((line) => JSON.parse(line)),
      nextCursor: start + selected.length
    }
  } catch (error) {
    throw createInvalidJsonError(EVENTS_FILE, error)
  }
}

async function summarizeProjectDirectory(root, directory) {
  const entries = await fs.readdir(path.join(root, directory), { withFileTypes: true }).catch((error) => {
    if (error && error.code === "ENOENT") return null
    throw error
  })

  if (!entries) {
    return {
      path: directory,
      exists: false,
      fileCount: 0,
      sample: []
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
    sample: names.slice(0, 8)
  }
}

async function hasConfiguredProvider(cinemaRoot) {
  const providers = await readOptionalJson(path.join(cinemaRoot, PROVIDERS_FILE), PROVIDERS_FILE)
  return Array.isArray(providers && providers.providers) && providers.providers.length > 0
}

function summarizeNodeData(node) {
  const text = typeof (node.data && node.data.text) === "string" && node.data.text.trim()
    ? node.data.text.trim()
    : undefined
  const status = typeof (node.data && node.data.status) === "string" && node.data.status.trim()
    ? node.data.status.trim()
    : undefined
  return {
    id: node.id,
    type: node.type,
    title: node.title,
    ...(text ? { text } : {}),
    ...(status ? { status } : {})
  }
}

function findProjectGaps(canvas, providerConfigured) {
  const types = new Set(canvas.nodes.map((node) => node.type))
  const gaps = []
  if (!types.has("shot")) gaps.push("no-shot-nodes")
  if (!types.has("prompt")) gaps.push("no-prompt-nodes")
  if (!types.has("generation-task")) gaps.push("no-generation-tasks")
  if (!providerConfigured) gaps.push("no-provider-configured")
  return gaps
}

function projectIdentity(root, project, legacyProjectID) {
  const projectID = typeof (project && project.id) === "string" && project.id.trim()
    ? project.id.trim()
    : typeof legacyProjectID === "string" && legacyProjectID.trim()
      ? legacyProjectID.trim()
      : path.basename(root)
  const name = typeof (project && project.name) === "string" && project.name.trim()
    ? project.name.trim()
    : path.basename(root) || projectID
  return { projectID, name }
}

async function buildProjectSummary(args) {
  const root = projectRootFromArgs(args)
  await assertProjectRootDirectory(root)
  const cinemaRoot = cinemaRootForProject(root)
  const directories = await Promise.all(PROJECT_DIRECTORIES.map((directory) => summarizeProjectDirectory(root, directory)))
  const project = await readOptionalJson(path.join(cinemaRoot, PROJECT_FILE), PROJECT_FILE)
  const initialized = Boolean(project)
  const identity = projectIdentity(root, project, args && args.projectID)

  if (!initialized) {
    return {
      ...identity,
      root,
      initialized: false,
      nodeCount: 0,
      edgeCount: 0,
      nodeTypeCounts: {},
      nodes: [],
      recentEvents: [],
      directories,
      gaps: ["project-not-initialized"]
    }
  }

  const canvasPath = path.join(cinemaRoot, CANVAS_FILE)
  const canvasExists = await pathExists(canvasPath)
  if (!canvasExists) {
    return {
      ...identity,
      root,
      initialized: true,
      project,
      nodeCount: 0,
      edgeCount: 0,
      nodeTypeCounts: {},
      nodes: [],
      recentEvents: [],
      directories,
      gaps: ["canvas-missing"]
    }
  }

  const canvas = await readCinemaCanvas(cinemaRoot)
  const events = await readCinemaEvents(cinemaRoot, { limit: 10 })
  const providerConfigured = await hasConfiguredProvider(cinemaRoot)
  const nodeTypeCounts = canvas.nodes.reduce((counts, node) => {
    counts[node.type] = (counts[node.type] ?? 0) + 1
    return counts
  }, {})

  return {
    ...identity,
    root,
    initialized: true,
    project,
    nodeCount: canvas.nodes.length,
    edgeCount: canvas.edges.length,
    nodeTypeCounts,
    nodes: canvas.nodes.map(summarizeNodeData),
    recentEvents: events.events,
    directories,
    gaps: findProjectGaps(canvas, providerConfigured)
  }
}

function defaultStoryNodeID(summary, explicitStoryNodeID) {
  if (explicitStoryNodeID) return explicitStoryNodeID
  const storyNode = Array.isArray(summary.nodes)
    ? summary.nodes.find((node) => node && node.type === "text")
    : undefined
  return storyNode && storyNode.id
}

function nodeText(node) {
  const text = node && node.text
  return typeof text === "string" && text.trim() ? text.trim() : undefined
}

async function getProjectSummary(args) {
  const summary = await buildProjectSummary(args || {})
  return textResult(
    `Cinema project '${summary.name}' has ${summary.nodeCount} node(s), ${summary.edgeCount} edge(s), and ${summary.gaps.length} gap(s).`,
    {
      kind: "cinema_project_summary",
      summary
    }
  )
}

async function applyCommand(args) {
  const root = projectRootFromArgs(args || {})
  const command = {
    actor: "cinema-plugin",
    ...((args && args.command) || {})
  }
  const result = await applyProjectCommand(root, command)

  return textResult(result.event.message, {
    kind: "cinema_apply_command_result",
    projectRoot: root,
    command: result.command,
    event: result.event,
    canvas: result.canvas
  })
}

async function createShotPlan(args) {
  const root = projectRootFromArgs(args || {})
  const shots = Array.isArray(args && args.shots) ? args.shots : []
  if (shots.length === 0) {
    throw pluginError("CINEMA_INVALID_INPUT", "shots must include at least one shot.", 400)
  }
  const origin = args && args.origin ? args.origin : {}
  const startX = Number.isFinite(origin.x) ? origin.x : 160
  const startY = Number.isFinite(origin.y) ? origin.y : 160
  const summary = await buildProjectSummary({ ...(args || {}), projectRoot: root })
  if (!summary.initialized) {
    throw pluginError("CINEMA_PROJECT_NOT_INITIALIZED", "This folder has not been initialized for anybox for cinema yet.", 404)
  }

  const sourceNodeID = defaultStoryNodeID(summary, args && args.storyNodeID)
  const results = []
  const created = []

  for (let index = 0; index < shots.length; index += 1) {
    const shot = shots[index] || {}
    const shotID = makeID("node-shot", index + 1)
    const promptID = shot.prompt ? makeID("node-prompt", index + 1) : undefined
    const x = startX + (index % 2) * 460
    const y = startY + Math.floor(index / 2) * 360
    const title = String(shot.title || `Shot ${index + 1}`).trim() || `Shot ${index + 1}`

    const shotNode = {
      id: shotID,
      type: "shot",
      title,
      position: { x, y },
      size: { width: 380, height: 250 },
      data: compactObject({
        text: typeof shot.text === "string" ? shot.text : "",
        placeholder: "Shot description, duration, and visual intent.",
        status: "planned"
      })
    }

    results.push(await applyProjectCommand(root, {
      id: makeID("cmd-create-shot", index + 1),
      type: "create-node",
      node: shotNode
    }))
    created.push({ shotNode })

    if (sourceNodeID) {
      results.push(await applyProjectCommand(root, {
        id: makeID("cmd-connect-story-shot", index + 1),
        type: "connect-nodes",
        edge: {
          id: makeID(`edge-${sourceNodeID}-${shotID}`, index + 1),
          source: sourceNodeID,
          target: shotID
        }
      }))
    }

    if (promptID) {
      const promptNode = {
        id: promptID,
        type: "prompt",
        title: `${title} Prompt`,
        position: { x: x + 460, y },
        size: { width: 380, height: 240 },
        data: {
          text: shot.prompt,
          placeholder: "Prompt draft or reusable generation instruction."
        }
      }

      results.push(await applyProjectCommand(root, {
        id: makeID("cmd-create-prompt", index + 1),
        type: "create-node",
        node: promptNode
      }))
      results.push(await applyProjectCommand(root, {
        id: makeID("cmd-connect-shot-prompt", index + 1),
        type: "connect-nodes",
        edge: {
          id: makeID(`edge-${shotID}-${promptID}`, index + 1),
          source: shotID,
          target: promptID
        }
      }))
      created[created.length - 1].promptNode = promptNode
    }
  }

  const latestCanvas = results.length > 0 ? results[results.length - 1].canvas : undefined
  const summaryText = created
    .map((entry, index) => {
      const promptText = entry.promptNode ? " with prompt" : ""
      return `${index + 1}. ${entry.shotNode.title}${promptText}${nodeText(entry.shotNode.data) ? ` - ${nodeText(entry.shotNode.data)}` : ""}`
    })
    .join("\n")

  return textResult(`Created ${created.length} Cinema shot node(s).\n${summaryText}`, {
    kind: "cinema_create_shot_plan_result",
    projectRoot: root,
    projectID: summary.projectID,
    sourceNodeID,
    created,
    eventCount: results.length,
    events: results.map((result) => result.event),
    canvas: latestCanvas
  })
}

async function callTool(name, args) {
  if (name === "cinema_get_project_summary") return await getProjectSummary(args || {})
  if (name === "cinema_apply_command") return await applyCommand(args || {})
  if (name === "cinema_create_shot_plan") return await createShotPlan(args || {})
  throw pluginError("CINEMA_UNKNOWN_TOOL", `Unknown tool: ${name}`, 404)
}

const rl = readline.createInterface({ input: process.stdin })

rl.on("line", (line) => {
  void (async () => {
    const normalizedLine = line.replace(/^\uFEFF/, "")
    if (!normalizedLine.trim()) return
    const message = JSON.parse(normalizedLine)

    if (message.method === "initialize") {
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "anybox-cinema", version: "0.1.0" }
        }
      })
      return
    }

    if (String(message.method || "").startsWith("notifications/")) return

    if (message.method === "tools/list") {
      send({ jsonrpc: "2.0", id: message.id, result: { tools } })
      return
    }

    if (message.method === "tools/call") {
      try {
        const result = await callTool(
          message.params && message.params.name,
          message.params && message.params.arguments
        )
        send({ jsonrpc: "2.0", id: message.id, result })
      } catch (error) {
        send({ jsonrpc: "2.0", id: message.id, result: errorResult(error) })
      }
      return
    }

    send({
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32601, message: `Unknown method: ${message.method}` }
    })
  })().catch((error) => {
    send({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : String(error)
      }
    })
  })
})
