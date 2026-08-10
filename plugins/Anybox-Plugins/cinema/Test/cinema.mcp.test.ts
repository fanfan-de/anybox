import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const mcpPath = path.join(pluginRoot, "mcp", "server.js")
const roots: string[] = []
const children: Array<ReturnType<typeof Bun.spawn>> = []

type RpcResponse = {
  id: number
  result?: {
    tools?: Array<{ name: string }>
    isError?: boolean
    structuredContent?: Record<string, any>
  }
  error?: { code: number; message: string }
}

function createLineReader(stream: ReadableStream<Uint8Array>) {
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ""
  return async () => {
    while (true) {
      const newline = buffer.indexOf("\n")
      if (newline >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (line) return line
        continue
      }
      const next = await reader.read()
      if (next.done) throw new Error("Cinema MCP exited before returning a response.")
      buffer += next.value
    }
  }
}

function mcpClient(dataDir: string) {
  const child = Bun.spawn([process.execPath, mcpPath], {
    cwd: pluginRoot,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
    env: {
      ...process.env,
      ANYBOX_APP_DATA_DIR: dataDir,
      ANYBOX_APP_CACHE_DIR: path.join(dataDir, "cache"),
      ANYBOX_APP_LOG_DIR: path.join(dataDir, "logs"),
    },
  })
  children.push(child)
  const readLine = createLineReader(child.stdout)
  let id = 0
  return {
    child,
    async call(method: string, params?: Record<string, unknown>) {
      const requestID = ++id
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: requestID, method, ...(params ? { params } : {}) })}\n`)
      child.stdin.flush()
      while (true) {
        const response = JSON.parse(await readLine()) as RpcResponse
        if (response.id === requestID) return response
      }
    },
  }
}

async function createProject(root: string) {
  const projectID = `cin_${crypto.randomUUID()}`
  const cinemaRoot = path.join(root, ".anybox-cinema")
  await mkdir(path.join(cinemaRoot, "tasks"), { recursive: true })
  await mkdir(path.join(cinemaRoot, "timelines"), { recursive: true })
  await writeFile(path.join(cinemaRoot, "project.json"), `${JSON.stringify({
    schemaVersion: 1,
    runtimeVersion: 1,
    projectType: "anybox-for-cinema",
    id: projectID,
    name: "MCP concurrency fixture",
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
    status: "draft",
    description: "",
    language: "",
  }, null, 2)}\n`)
  await writeFile(path.join(cinemaRoot, "canvas.json"), `${JSON.stringify({
    schemaVersion: 1,
    canvasType: "node-canvas",
    revision: 0,
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [],
    edges: [],
    nodeTypes: ["text", "image", "video", "audio"],
  }, null, 2)}\n`)
  await writeFile(path.join(cinemaRoot, "events.jsonl"), "")
  return { projectID, cinemaRoot }
}

afterEach(async () => {
  await Promise.all(children.splice(0).map(async (child) => {
    child.kill()
    await child.exited.catch(() => undefined)
  }))
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("Cinema MCP shared storage", () => {
  test("uses the same revision, idempotency, JSONL, and cross-process project lock as the Runtime", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "cinema-mcp-project-"))
    const data = await mkdtemp(path.join(os.tmpdir(), "cinema-mcp-data-"))
    roots.push(root, data)
    const { cinemaRoot } = await createProject(root)
    const first = mcpClient(data)
    const second = mcpClient(data)

    const initialized = await first.call("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "cinema-test", version: "1" },
    })
    expect(initialized.result).toMatchObject({ protocolVersion: "2025-06-18" })
    const listed = await first.call("tools/list")
    expect(listed.result?.tools?.map((tool) => tool.name)).toEqual([
      "cinema_get_project_summary",
      "cinema_apply_command",
      "cinema_create_storyboard",
    ])

    const createNode = (id: string) => ({
      name: "cinema_apply_command",
      arguments: {
        projectRoot: root,
        command: {
          id: `command-${id}`,
          actor: "mcp-concurrency-test",
          baseRevision: 0,
          type: "create-node",
          node: {
            id,
            type: "text",
            title: id,
            position: { x: 10, y: 10 },
            size: { width: 320, height: 200 },
            data: { text: id },
          },
        },
      },
    })
    const concurrent = await Promise.all([
      first.call("tools/call", createNode("node-first")),
      second.call("tools/call", createNode("node-second")),
    ])
    expect(concurrent.filter((response) => response.result?.isError === false)).toHaveLength(1)
    expect(concurrent.filter((response) => response.result?.isError === true)).toHaveLength(1)
    expect(concurrent.find((response) => response.result?.isError)?.result?.structuredContent?.error?.code)
      .toBe("CINEMA_CANVAS_REVISION_CONFLICT")

    const storyboardInput = {
      name: "cinema_create_storyboard",
      arguments: {
        projectRoot: root,
        idempotencyKey: "stable-storyboard",
        includeImageNodes: true,
        shots: [{ title: "Shot one", text: "Opening", prompt: "A wide establishing frame" }],
      },
    }
    const storyboard = await first.call("tools/call", storyboardInput)
    expect(storyboard.result?.isError).toBe(false)
    const replay = await first.call("tools/call", storyboardInput)
    expect(replay.result?.isError).toBe(false)
    expect(replay.result?.structuredContent?.created).toEqual(storyboard.result?.structuredContent?.created)

    const canvas = JSON.parse(await readFile(path.join(cinemaRoot, "canvas.json"), "utf8"))
    expect(canvas.nodes).toHaveLength(3)
    expect(canvas.edges).toHaveLength(1)
    expect(canvas.revision).toBe(4)
    const events = (await readFile(path.join(cinemaRoot, "events.jsonl"), "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
    expect(events).toHaveLength(4)
    expect(events.every((event) => typeof event.type === "string")).toBe(true)
    expect((await stat(path.join(cinemaRoot, ".locks"))).isDirectory()).toBe(true)
    expect(await readdir(path.join(cinemaRoot, ".locks"))).toEqual([])
  }, 30_000)
})
