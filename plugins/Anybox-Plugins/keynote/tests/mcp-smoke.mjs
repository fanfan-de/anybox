import { spawn } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const testRoot = path.dirname(fileURLToPath(import.meta.url))
const pluginRoot = path.resolve(testRoot, "..")
const projectRoot = path.join(pluginRoot, "runtime", "keynote-mcp")
const environmentRoot = await mkdtemp(path.join(tmpdir(), "anybox-keynote-mcp-smoke-"))
const uvCommand = process.env.KEYNOTE_UV_PATH?.trim() || "uv"
const withUnsplash = process.argv.includes("--with-unsplash")
const timeoutMs = 120_000

const child = spawn(
  uvCommand,
  [
    "run",
    "--project",
    projectRoot,
    "--frozen",
    "--no-dev",
    "--no-editable",
    "--python",
    "3.12",
    "keynote-mcp",
  ],
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      UV_PROJECT_ENVIRONMENT: environmentRoot,
      PYTHONUNBUFFERED: "1",
      PYTHONDONTWRITEBYTECODE: "1",
      UNSPLASH_KEY: withUnsplash ? "anybox-smoke-test-key" : "",
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
      throw new Error(`Keynote MCP exited with code ${child.exitCode}.\n${stderr.trim()}`)
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
        name: "anybox-keynote-mcp-smoke",
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
  const toolNames = listed.result.tools.map((tool) => tool.name)
  const requiredTools = [
    "create_presentation",
    "get_slide_content",
    "clear_slide",
    "add_shape",
    "add_builds_to_slide",
    "screenshot_slide",
    "export_pdf",
  ]

  for (const toolName of requiredTools) {
    if (!toolNames.includes(toolName)) throw new Error(`Missing expected MCP tool: ${toolName}`)
  }
  const unsplashTools = [
    "search_unsplash_images",
    "add_unsplash_image_to_slide",
    "get_random_unsplash_image",
  ]
  if (!withUnsplash && unsplashTools.some((toolName) => toolNames.includes(toolName))) {
    throw new Error("Unsplash tools must remain unregistered when UNSPLASH_KEY is empty.")
  }
  if (withUnsplash) {
    for (const toolName of unsplashTools) {
      if (!toolNames.includes(toolName)) throw new Error(`Missing optional Unsplash MCP tool: ${toolName}`)
    }
  }

  process.stdout.write(`${JSON.stringify({
    protocolVersion: initialized.result.protocolVersion,
    toolCount: toolNames.length,
    requiredTools,
    unsplashRegistered: withUnsplash,
  }, null, 2)}\n`)
} finally {
  await stopChild()
  await rm(environmentRoot, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  })
}
