const assert = require("node:assert/strict")
const { spawn } = require("node:child_process")
const fs = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const readline = require("node:readline")
const test = require("node:test")

const serverPath = path.join(__dirname, "server.js")

function startServer() {
  const child = spawn(process.execPath, [serverPath], { stdio: ["pipe", "pipe", "inherit"] })
  const lines = readline.createInterface({ input: child.stdout })
  const pending = new Map()
  let nextID = 1

  lines.on("line", (line) => {
    const message = JSON.parse(line)
    const resolve = pending.get(message.id)
    if (resolve) {
      pending.delete(message.id)
      resolve(message)
    }
  })

  return {
    request(method, params) {
      const id = nextID++
      const response = new Promise((resolve) => pending.set(id, resolve))
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`)
      return response
    },
    async close() {
      child.stdin.end()
      await new Promise((resolve, reject) => {
        child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Cinema MCP exited with ${code}`)))
      })
    }
  }
}

async function createProject() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "anybox-cinema-plugin-"))
  const cinemaRoot = path.join(root, ".anybox-cinema")
  await fs.mkdir(cinemaRoot)
  await fs.writeFile(path.join(cinemaRoot, "project.json"), JSON.stringify({
    schemaVersion: 1,
    projectType: "anybox-for-cinema",
    id: "test-project",
    name: "Test Project"
  }))
  await fs.writeFile(path.join(cinemaRoot, "providers.json"), JSON.stringify({ providers: [] }))
  await fs.writeFile(path.join(cinemaRoot, "canvas.json"), JSON.stringify({
    schemaVersion: 1,
    canvasType: "node-canvas",
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [],
    edges: [],
    nodeTypes: []
  }))
  return root
}

test("lists only the four-node Cinema tools and command schema", async () => {
  const server = startServer()
  try {
    const response = await server.request("tools/list")
    const tools = response.result.tools
    assert.deepEqual(tools.map((tool) => tool.name), [
      "cinema_get_project_summary",
      "cinema_apply_command",
      "cinema_create_storyboard"
    ])

    const applyTool = tools.find((tool) => tool.name === "cinema_apply_command")
    assert.deepEqual(applyTool.inputSchema.properties.command.properties.node.properties.type.enum, [
      "text",
      "image",
      "video",
      "audio"
    ])
    assert.deepEqual(applyTool.inputSchema.properties.command.properties.type.enum, [
      "create-node",
      "update-node",
      "delete-node",
      "connect-nodes",
      "disconnect-edge",
      "update-viewport"
    ])
  } finally {
    await server.close()
  }
})

test("creates a Text to Image storyboard and rejects removed node types", async () => {
  const root = await createProject()
  const server = startServer()
  try {
    const storyboard = await server.request("tools/call", {
      name: "cinema_create_storyboard",
      arguments: {
        projectRoot: root,
        shots: [
          { title: "Arrival", text: "A train enters the station.", prompt: "Cinematic night train" },
          { title: "Platform", text: "The traveler steps down.", prompt: "Rainy platform" }
        ]
      }
    })

    assert.equal(storyboard.result.isError, false)
    const canvas = storyboard.result.structuredContent.canvas
    assert.deepEqual(canvas.nodes.map((node) => node.type), ["text", "image", "text", "image"])
    assert.equal(canvas.edges.length, 2)
    for (const edge of canvas.edges) {
      assert.equal(canvas.nodes.find((node) => node.id === edge.source).type, "text")
      assert.equal(canvas.nodes.find((node) => node.id === edge.target).type, "image")
    }

    const removedType = await server.request("tools/call", {
      name: "cinema_apply_command",
      arguments: {
        projectRoot: root,
        command: {
          type: "create-node",
          node: {
            id: "removed-shot",
            type: "shot",
            title: "Removed Shot",
            position: { x: 0, y: 0 }
          }
        }
      }
    })
    assert.equal(removedType.result.isError, true)
    assert.equal(removedType.result.structuredContent.error.code, "CINEMA_INVALID_INPUT")
  } finally {
    await server.close()
    await fs.rm(root, { recursive: true, force: true })
  }
})
