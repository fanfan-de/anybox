#!/usr/bin/env node

const readline = require("node:readline")
const os = require("node:os")
const path = require("node:path")
const { pathToFileURL } = require("node:url")
const { createRequire } = require("node:module")
const Module = require("node:module")
const { ensureNativeMessagingHost } = require("./native-host-bootstrap")

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_TIMEOUT_MS = 120_000
const browserClientPath = path.resolve(__dirname, "browser-client.mjs")
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

let browserClientPromise
let sandbox
let writes
let images
const nodeModuleDirs = []
const nativeMessagingHostReady = ensureNativeMessagingHost()

const tools = [
  {
    name: "node_repl_js",
    title: "Node REPL JavaScript",
    description: "Run JavaScript in a persistent Node.js REPL with Chrome runtime helpers.",
    inputSchema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "JavaScript source to run. Top-level await is supported.",
        },
        timeoutMs: {
          type: "number",
          description: "Execution timeout in milliseconds.",
        },
      },
      required: ["code"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: "node_repl_reset",
    title: "Reset Node REPL",
    description: "Reset the persistent Node.js REPL state.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "node_repl_add_node_module_dir",
    title: "Add Node Module Directory",
    description: "Add a node_modules directory to CommonJS module resolution for later REPL calls.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute node_modules directory path.",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
]

function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

function textBlock(text) {
  return { type: "text", text }
}

function textResult(text, structuredContent) {
  return {
    content: [textBlock(text)],
    structuredContent,
    isError: false,
  }
}

function errorResult(error) {
  const message = error instanceof Error ? error.message : String(error)
  return {
    content: [textBlock(message)],
    structuredContent: { error: message },
    isError: true,
  }
}

function printable(value) {
  if (value === undefined) return ""
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function addNodeModuleDir(dir) {
  const normalized = path.resolve(String(dir || ""))
  if (!normalized) throw new Error("path is required.")
  if (!nodeModuleDirs.includes(normalized)) nodeModuleDirs.push(normalized)
  process.env.NODE_PATH = nodeModuleDirs.join(path.delimiter)
  Module._initPaths()
  return normalized
}

async function loadBrowserClient() {
  if (!browserClientPromise) {
    browserClientPromise = import(pathToFileURL(browserClientPath).toString())
  }
  return browserClientPromise
}

function resetKernel() {
  writes = []
  images = []
  const localRequire = createRequire(__filename)
  sandbox = {
    Buffer,
    URL,
    URLSearchParams,
    atob: globalThis.atob,
    btoa: globalThis.btoa,
    clearInterval,
    clearTimeout,
    console: {
      log: (...args) => writes.push(args.map(printable).join(" ")),
      error: (...args) => writes.push(args.map(printable).join(" ")),
      warn: (...args) => writes.push(args.map(printable).join(" ")),
      info: (...args) => writes.push(args.map(printable).join(" ")),
    },
    fetch: globalThis.fetch,
    require: localRequire,
    setInterval,
    setTimeout,
    process: undefined,
  }
  sandbox.global = sandbox
  sandbox.globalThis = sandbox
  sandbox.nodeRepl = {
    cwd: process.cwd(),
    homeDir: os.homedir(),
    tmpDir: os.tmpdir(),
    nodeModuleDirs,
    addNodeModuleDir,
    write(text) {
      writes.push(String(text))
    },
    async emitImage(imageLike) {
      const image = normalizeImage(imageLike)
      images.push(image)
      return image
    },
  }
}

function normalizeImage(imageLike) {
  if (typeof imageLike === "string" && imageLike.startsWith("data:")) {
    const match = /^data:([^;,]+);base64,(.*)$/s.exec(imageLike)
    if (!match) throw new Error("Only base64 data URLs are supported for images.")
    return { type: "image", mimeType: match[1], data: match[2] }
  }
  if (Buffer.isBuffer(imageLike) || imageLike instanceof Uint8Array) {
    return { type: "image", mimeType: "image/png", data: Buffer.from(imageLike).toString("base64") }
  }
  if (imageLike && typeof imageLike === "object" && imageLike.bytes) {
    return {
      type: "image",
      mimeType: imageLike.mimeType || "image/png",
      data: Buffer.from(imageLike.bytes).toString("base64"),
    }
  }
  throw new Error("Unsupported image payload.")
}

function timeoutMs(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TIMEOUT_MS
  return Math.min(Math.trunc(parsed), MAX_TIMEOUT_MS)
}

async function runWithTimeout(promise, ms) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Execution timed out after ${ms}ms.`)), ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function runJavaScript(code, ms) {
  const browserClient = await loadBrowserClient()
  sandbox.setupBrowserRuntime = browserClient.setupBrowserRuntime
  if (!sandbox.agent) await browserClient.setupBrowserRuntime({ globals: sandbox })

  writes = []
  images = []
  const fn = new AsyncFunction(
    "sandbox",
    "nodeRepl",
    "agent",
    "setupBrowserRuntime",
    `with (sandbox) { return await (async () => {\n${code}\n})() }`,
  )
  const value = await runWithTimeout(
    fn.call(sandbox, sandbox, sandbox.nodeRepl, sandbox.agent, browserClient.setupBrowserRuntime),
    ms,
  )

  const textParts = [...writes]
  const printed = printable(value)
  if (printed) textParts.push(printed)
  const content = textParts.length > 0 ? [textBlock(textParts.join("\n"))] : []
  content.push(...images)
  if (content.length === 0) content.push(textBlock(""))

  return {
    content,
    structuredContent: {
      result: value === undefined ? null : value,
      writes,
      imageCount: images.length,
    },
    isError: false,
  }
}

async function callTool(name, args) {
  if (name === "node_repl_reset") {
    resetKernel()
    return textResult("Node REPL reset.", { reset: true })
  }

  if (name === "node_repl_add_node_module_dir") {
    const added = addNodeModuleDir(args && args.path)
    return textResult(`Added node_modules directory: ${added}`, { path: added })
  }

  if (name === "node_repl_js") {
    const code = args && typeof args.code === "string" ? args.code : ""
    if (!code.trim()) throw new Error("node_repl_js requires code.")
    return runJavaScript(code, timeoutMs(args && args.timeoutMs))
  }

  throw new Error(`Unknown tool: ${name}`)
}

resetKernel()

const rl = readline.createInterface({ input: process.stdin })

rl.on("line", (line) => {
  void (async () => {
    if (!line.trim()) return
    const message = JSON.parse(line)

    if (message.method === "initialize") {
      await nativeMessagingHostReady
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "anybox-node-repl", version: "0.1.0" },
        },
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
        const result = await callTool(message.params && message.params.name, message.params && message.params.arguments)
        send({ jsonrpc: "2.0", id: message.id, result })
      } catch (error) {
        send({ jsonrpc: "2.0", id: message.id, result: errorResult(error) })
      }
      return
    }

    if (message.method === "ping") {
      send({ jsonrpc: "2.0", id: message.id, result: {} })
      return
    }

    if (message.method === "roots/list") {
      send({ jsonrpc: "2.0", id: message.id, result: { roots: [] } })
      return
    }

    if (message.id !== undefined) {
      send({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: `Unknown method: ${message.method}` },
      })
    }
  })().catch((error) => {
    send({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : String(error),
      },
    })
  })
})

rl.on("close", () => process.exit(0))
