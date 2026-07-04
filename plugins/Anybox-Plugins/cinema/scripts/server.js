#!/usr/bin/env node

const readline = require("node:readline")

const DEFAULT_AGENT_BASE_URL = "http://127.0.0.1:4096"
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
    description: "Read an initialized Cinema project's summary, node counts, recent events, directory overview, and gaps.",
    inputSchema: {
      type: "object",
      properties: {
        projectID: { type: "string", minLength: 1, description: "Anybox project id." }
      },
      required: ["projectID"],
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
    description: "Apply a Cinema canvas command through the local Anybox Agent Cinema API.",
    inputSchema: {
      type: "object",
      properties: {
        projectID: { type: "string", minLength: 1, description: "Anybox project id." },
        command: commandSchema
      },
      required: ["projectID", "command"],
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
    description: "Create Shot and Prompt nodes for a multi-shot plan and connect them on the Cinema canvas.",
    inputSchema: {
      type: "object",
      properties: {
        projectID: { type: "string", minLength: 1, description: "Anybox project id." },
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
      required: ["projectID", "shots"],
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

function baseURL() {
  return (
    process.env.ANYBOX_AGENT_BASE_URL ||
    process.env.ANYBOX_CINEMA_AGENT_BASE_URL ||
    DEFAULT_AGENT_BASE_URL
  ).replace(/\/+$/, "")
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

function encodePathSegment(value) {
  return encodeURIComponent(String(value))
}

async function apiRequest(pathname, init = {}) {
  const url = new URL(pathname, `${baseURL()}/`)
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers || {})
    }
  })
  const text = await response.text()
  let body
  try {
    body = text ? JSON.parse(text) : undefined
  } catch {
    body = undefined
  }

  if (!response.ok || !body || body.success !== true) {
    const apiError = body && body.error && typeof body.error === "object" ? body.error : undefined
    const error = new Error(
      apiError && typeof apiError.message === "string"
        ? apiError.message
        : `Cinema API request failed with status ${response.status}`
    )
    error.code = apiError && typeof apiError.code === "string" ? apiError.code : `HTTP_${response.status}`
    error.status = response.status
    throw error
  }

  return body.data
}

function makeID(prefix, index) {
  const stamp = Date.now().toString(36)
  const suffix = Math.random().toString(36).slice(2, 7)
  return `${prefix}-${stamp}-${index}-${suffix}`
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  )
}

function nodeText(node) {
  const text = node && node.text
  return typeof text === "string" && text.trim() ? text.trim() : undefined
}

async function getProjectSummary(args) {
  const projectID = args && args.projectID
  const summary = await apiRequest(`/api/cinema/projects/${encodePathSegment(projectID)}/summary`)
  return textResult(
    `Cinema project '${summary.name}' has ${summary.nodeCount} node(s), ${summary.edgeCount} edge(s), and ${summary.gaps.length} gap(s).`,
    {
      kind: "cinema_project_summary",
      summary
    }
  )
}

async function applyCommand(args) {
  const projectID = args && args.projectID
  const command = {
    actor: "cinema-plugin",
    ...(args && args.command ? args.command : {})
  }
  const result = await apiRequest(`/api/cinema/projects/${encodePathSegment(projectID)}/commands`, {
    method: "POST",
    body: JSON.stringify(command)
  })

  return textResult(result.event.message, {
    kind: "cinema_apply_command_result",
    command,
    event: result.event,
    canvas: result.canvas
  })
}

async function applyProjectCommand(projectID, command) {
  return await apiRequest(`/api/cinema/projects/${encodePathSegment(projectID)}/commands`, {
    method: "POST",
    body: JSON.stringify({
      actor: "cinema-plugin",
      ...command
    })
  })
}

function defaultStoryNodeID(summary, explicitStoryNodeID) {
  if (explicitStoryNodeID) return explicitStoryNodeID
  const storyNode = Array.isArray(summary.nodes)
    ? summary.nodes.find((node) => node && node.type === "text")
    : undefined
  return storyNode && storyNode.id
}

async function createShotPlan(args) {
  const projectID = args && args.projectID
  const shots = Array.isArray(args && args.shots) ? args.shots : []
  const origin = args && args.origin ? args.origin : {}
  const startX = Number.isFinite(origin.x) ? origin.x : 160
  const startY = Number.isFinite(origin.y) ? origin.y : 160
  const summary = await apiRequest(`/api/cinema/projects/${encodePathSegment(projectID)}/summary`)
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

    results.push(await applyProjectCommand(projectID, {
      id: makeID("cmd-create-shot", index + 1),
      type: "create-node",
      node: shotNode
    }))
    created.push({ shotNode })

    if (sourceNodeID) {
      results.push(await applyProjectCommand(projectID, {
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

      results.push(await applyProjectCommand(projectID, {
        id: makeID("cmd-create-prompt", index + 1),
        type: "create-node",
        node: promptNode
      }))
      results.push(await applyProjectCommand(projectID, {
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
    projectID,
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
  throw new Error(`Unknown tool: ${name}`)
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
