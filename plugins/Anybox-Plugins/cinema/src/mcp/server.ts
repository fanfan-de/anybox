import path from "node:path"
import readline from "node:readline"
import { z } from "zod"
import {
  CinemaCommandSchema,
  type CinemaCanvasDocument,
  type CinemaCommand,
} from "../contracts/cinema.ts"
import {
  applyCinemaCommand,
  getCinemaCanvas,
  getCinemaProjectStateSummary,
} from "../api/cinema.ts"
import {
  initializeProjectRegistry,
  openProjectRoot,
} from "../storage/projects.ts"

const ProjectInput = z.object({ projectRoot: z.string().min(1) }).strict()
const ApplyCommandInput = ProjectInput.extend({ command: CinemaCommandSchema }).strict()
const StoryboardInput = ProjectInput.extend({
  idempotencyKey: z.string().min(1).max(128).optional(),
  origin: z.object({ x: z.number(), y: z.number() }).strict().optional(),
  includeImageNodes: z.boolean().default(true),
  shots: z.array(z.object({
    title: z.string().min(1),
    text: z.string().optional(),
    prompt: z.string().optional(),
  }).strict()).min(1).max(100),
}).strict()

type JsonRpcRequest = {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: { name?: string; arguments?: unknown }
}

type CommandWithoutBaseRevision = CinemaCommand extends infer Command
  ? Command extends CinemaCommand
    ? Omit<Command, "baseRevision">
    : never
  : never

const projectRootSchema = {
  type: "string",
  minLength: 1,
  description: "Absolute local folder path for an initialized Cinema project.",
} as const

const tools = [
  {
    name: "cinema_get_project_summary",
    title: "Get Cinema Project Summary",
    description: "Read a Cinema project through the same contracts and storage layer used by the Web Runtime.",
    inputSchema: {
      type: "object",
      properties: { projectRoot: projectRootSchema },
      required: ["projectRoot"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: "cinema_apply_command",
    title: "Apply Cinema Command",
    description: "Apply a revision-checked and idempotent Cinema canvas command using the Runtime storage implementation.",
    inputSchema: {
      type: "object",
      properties: {
        projectRoot: projectRootSchema,
        command: {
          type: "object",
          description: "A Cinema command with id, type, baseRevision, and the fields required by that command type.",
        },
      },
      required: ["projectRoot", "command"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  {
    name: "cinema_create_storyboard",
    title: "Create Cinema Storyboard",
    description: "Create connected Text and optional Image nodes through revision-checked Cinema commands.",
    inputSchema: {
      type: "object",
      properties: {
        projectRoot: projectRootSchema,
        idempotencyKey: { type: "string", minLength: 1, maxLength: 128 },
        origin: {
          type: "object",
          properties: { x: { type: "number" }, y: { type: "number" } },
          required: ["x", "y"],
          additionalProperties: false,
        },
        includeImageNodes: { type: "boolean", default: true },
        shots: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: {
            type: "object",
            properties: {
              title: { type: "string", minLength: 1 },
              text: { type: "string" },
              prompt: { type: "string" },
            },
            required: ["title"],
            additionalProperties: false,
          },
        },
      },
      required: ["projectRoot", "shots"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
] as const

function send(payload: unknown) {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

function textResult(text: string, structuredContent: Record<string, unknown>) {
  return { content: [{ type: "text", text }], structuredContent, isError: false }
}

function errorResult(error: unknown) {
  const value = error && typeof error === "object" ? error as Record<string, unknown> : {}
  const message = error instanceof Error ? error.message : String(error)
  return {
    content: [{ type: "text", text: message }],
    structuredContent: {
      kind: "cinema_error",
      error: {
        code: typeof value.code === "string" ? value.code : "CINEMA_PLUGIN_ERROR",
        message,
        ...(typeof value.status === "number" ? { status: value.status } : {}),
      },
    },
    isError: true,
  }
}

async function openProject(projectRoot: string) {
  if (!path.isAbsolute(projectRoot)) throw new Error("projectRoot must be an absolute local directory.")
  return await openProjectRoot(projectRoot)
}

async function projectSummary(input: unknown) {
  const args = ProjectInput.parse(input)
  const project = await openProject(args.projectRoot)
  const summary = await getCinemaProjectStateSummary(project.id)
  return textResult(
    `Cinema project '${summary.name}' has ${summary.nodeCount} node(s), ${summary.edgeCount} edge(s), and ${summary.gaps.length} gap(s).`,
    { kind: "cinema_project_summary", summary },
  )
}

async function applyCommand(input: unknown) {
  const args = ApplyCommandInput.parse(input)
  const project = await openProject(args.projectRoot)
  const result = await applyCinemaCommand(project.id, args.command)
  return textResult(result.event.message, {
    kind: "cinema_apply_command_result",
    projectID: project.id,
    projectRoot: project.worktree,
    command: args.command,
    ...result,
  })
}

function commandID(prefix: string, key: string, index: number) {
  return `mcp_${prefix}_${key.replace(/[^A-Za-z0-9._-]/g, "_")}_${index}`
}

async function applyAtCurrentRevision(projectID: string, command: CommandWithoutBaseRevision) {
  const canvas = await getCinemaCanvas(projectID)
  const parsed = CinemaCommandSchema.parse({
    ...command,
    baseRevision: canvas.revision ?? 0,
  })
  return await applyCinemaCommand(projectID, parsed)
}

async function createStoryboard(input: unknown) {
  const args = StoryboardInput.parse(input)
  const project = await openProject(args.projectRoot)
  const key = args.idempotencyKey ?? crypto.randomUUID()
  const origin = args.origin ?? { x: 160, y: 160 }
  const created: Array<{ textNodeID: string; imageNodeID?: string }> = []
  let latestCanvas: CinemaCanvasDocument = await getCinemaCanvas(project.id)

  for (const [index, shot] of args.shots.entries()) {
    const number = index + 1
    const textNodeID = commandID("story_text_node", key, number)
    const imageNodeID = args.includeImageNodes ? commandID("story_image_node", key, number) : undefined
    const y = origin.y + index * 320
    const textResultValue = await applyAtCurrentRevision(project.id, {
      id: commandID("story_text", key, number),
      actor: "cinema-mcp",
      type: "create-node",
      node: {
        id: textNodeID,
        type: "text",
        title: shot.title,
        position: { x: origin.x, y },
        size: { width: 360, height: 240 },
        data: { text: shot.text ?? "" },
      },
    })
    latestCanvas = textResultValue.canvas

    if (imageNodeID) {
      const imageResult = await applyAtCurrentRevision(project.id, {
        id: commandID("story_image", key, number),
        actor: "cinema-mcp",
        type: "create-node",
        node: {
          id: imageNodeID,
          type: "image",
          title: `${shot.title} Image`,
          position: { x: origin.x + 440, y },
          size: { width: 360, height: 260 },
          data: { prompt: shot.prompt ?? "" },
        },
      })
      latestCanvas = imageResult.canvas
      const edgeResult = await applyAtCurrentRevision(project.id, {
        id: commandID("story_edge", key, number),
        actor: "cinema-mcp",
        type: "connect-nodes",
        edge: {
          id: commandID("story_edge_value", key, number),
          source: textNodeID,
          target: imageNodeID,
        },
      })
      latestCanvas = edgeResult.canvas
    }
    created.push({ textNodeID, ...(imageNodeID ? { imageNodeID } : {}) })
  }

  return textResult(`Created ${created.length} Cinema storyboard item(s).`, {
    kind: "cinema_create_storyboard_result",
    projectID: project.id,
    projectRoot: project.worktree,
    idempotencyKey: key,
    created,
    canvas: latestCanvas,
  })
}

async function callTool(name: string | undefined, args: unknown) {
  if (name === "cinema_get_project_summary") return await projectSummary(args)
  if (name === "cinema_apply_command") return await applyCommand(args)
  if (name === "cinema_create_storyboard") return await createStoryboard(args)
  throw new Error(`Unknown Cinema MCP tool '${name ?? ""}'.`)
}

await initializeProjectRegistry()
const lines = readline.createInterface({ input: process.stdin })
lines.on("line", (line) => {
  void (async () => {
    const message = JSON.parse(line.replace(/^\uFEFF/, "")) as JsonRpcRequest
    if (message.method === "initialize") {
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "anybox-cinema", version: "1.0.0" },
        },
      })
      return
    }
    if (message.method?.startsWith("notifications/")) return
    if (message.method === "tools/list") {
      send({ jsonrpc: "2.0", id: message.id, result: { tools } })
      return
    }
    if (message.method === "tools/call") {
      try {
        send({
          jsonrpc: "2.0",
          id: message.id,
          result: await callTool(message.params?.name, message.params?.arguments),
        })
      } catch (error) {
        send({ jsonrpc: "2.0", id: message.id, result: errorResult(error) })
      }
      return
    }
    send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Unknown method: ${message.method}` } })
  })().catch((error) => {
    send({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32603, message: error instanceof Error ? error.message : String(error) },
    })
  })
})
