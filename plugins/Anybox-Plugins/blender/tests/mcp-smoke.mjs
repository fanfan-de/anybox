import { spawn } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const testRoot = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(testRoot, "..")
const projectRoot = path.join(pluginRoot, "runtime", "blender-mcp")
const launcherPath = path.join(pluginRoot, "scripts", "launch_blender_mcp.py")
const temporaryRoot = await mkdtemp(path.join(tmpdir(), "anybox-blender-mcp-smoke-"))
const uvCommand = process.env.BLENDER_UV_PATH?.trim() || "uv"
const timeoutMs = 180_000

const child = spawn(
  uvCommand,
  [
    "run",
    "--no-project",
    "--python",
    "3.11",
    launcherPath,
  ],
  {
    cwd: pluginRoot,
    env: {
      ...process.env,
      BLENDER_MCP_HOST: "localhost",
      BLENDER_MCP_PORT: "9876",
      BLENDER_MCP_PROJECT: projectRoot,
      BLENDER_UV_PATH: uvCommand,
      UV_PROJECT_ENVIRONMENT: path.join(temporaryRoot, "venv"),
      UV_NO_PROGRESS: "1",
      PYTHONUNBUFFERED: "1",
      PYTHONDONTWRITEBYTECODE: "1",
    },
    stdio: ["pipe", "pipe", "pipe"],
  },
)

const exitPromise = new Promise((resolve) => child.once("exit", resolve))
const messages = []
let stdoutBuffer = ""
let stderr = ""
let protocolError

child.stdout.setEncoding("utf8")
child.stderr.setEncoding("utf8")
child.stdout.on("data", (chunk) => {
  stdoutBuffer += chunk
  let newlineIndex
  while ((newlineIndex = stdoutBuffer.indexOf("\n")) >= 0) {
    const line = stdoutBuffer.slice(0, newlineIndex).trim()
    stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1)
    if (!line) continue
    try {
      messages.push(JSON.parse(line))
    } catch (error) {
      protocolError = new Error(`Non-JSON output on MCP stdout: ${line}`, { cause: error })
    }
  }
})
child.stderr.on("data", (chunk) => {
  stderr += chunk
})

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`)
}

async function waitForResponse(id) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (protocolError) throw protocolError
    const response = messages.find((message) => message.id === id)
    if (response) {
      if (response.error) throw new Error(`MCP request ${id} failed: ${JSON.stringify(response.error)}`)
      return response
    }
    if (child.exitCode !== null) {
      throw new Error(`Blender MCP exited with code ${child.exitCode}.\n${stderr.trim()}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`Timed out waiting for MCP response ${id}.\n${stderr.trim()}`)
}

async function stopChild() {
  child.stdin.end()
  const exitedGracefully = await Promise.race([
    exitPromise.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 2_000)),
  ])
  if (!exitedGracefully && child.exitCode === null) {
    child.kill()
    await exitPromise
  }
}

try {
  send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: {
        name: "anybox-blender-mcp-smoke",
        version: "0.1.0",
      },
    },
  })
  const initialized = await waitForResponse(1)

  send({
    jsonrpc: "2.0",
    method: "notifications/initialized",
    params: {},
  })
  send({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {},
  })
  const listed = await waitForResponse(2)
  const toolNames = listed.result.tools.map((tool) => tool.name).sort()
  const requiredTools = [
    "execute_blender_code",
    "execute_blender_code_for_cli",
    "get_blendfile_summary_datablocks_for_cli",
    "get_objects_summary",
    "get_screenshot_of_window_as_image",
    "render_viewport_to_path",
    "search_api_docs",
    "search_manual_docs",
  ]

  for (const toolName of requiredTools) {
    if (!toolNames.includes(toolName)) throw new Error(`Missing expected MCP tool: ${toolName}`)
  }
  if (toolNames.length !== 26) {
    throw new Error(`Expected 26 reviewed tools, received ${toolNames.length}: ${toolNames.join(", ")}`)
  }

  send({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "search_api_docs",
      arguments: {
        query: "bpy.data.objects",
        max_results: 1,
      },
    },
  })
  const searched = await waitForResponse(3)
  if (!Array.isArray(searched.result.content) || searched.result.content.length === 0) {
    throw new Error("search_api_docs returned no MCP content.")
  }

  process.stdout.write(`${JSON.stringify({
    protocolVersion: initialized.result.protocolVersion,
    toolCount: toolNames.length,
    requiredTools,
    documentationSearchReturnedContent: true,
  }, null, 2)}\n`)
} finally {
  await stopChild()
  await rm(temporaryRoot, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  })
}
