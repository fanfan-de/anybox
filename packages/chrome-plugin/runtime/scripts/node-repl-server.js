#!/usr/bin/env node

const readline = require("node:readline")
const os = require("node:os")
const path = require("node:path")
const { pathToFileURL } = require("node:url")
const { createRequire } = require("node:module")
const { AsyncLocalStorage } = require("node:async_hooks")
const { Worker } = require("node:worker_threads")
const Module = require("node:module")
const { ensureNativeMessagingHost } = require("./native-host-bootstrap")

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_TIMEOUT_MS = 120_000
const browserClientPath = path.resolve(__dirname, "browser-client.mjs")
const browserGatewayWorkerPath = path.resolve(__dirname, "browser-gateway-worker.js")
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

let browserClientPromise
let sandbox
let writes
let images
const nodeModuleDirs = []
const nativeMessagingHostReady = ensureNativeMessagingHost()
const browserGateway = createBrowserGateway()
const browserRequestContext = new AsyncLocalStorage()
let runtimeReadyPromise

const tools = [
  {
    name: "js",
    title: "Chrome Node REPL JavaScript",
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
    name: "js_reset",
    title: "Reset Chrome Node REPL",
    description: "Reset the persistent Node.js REPL state.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "js_add_node_module_dir",
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
  const code = error && typeof error === "object" && typeof error.code === "string"
    ? error.code
    : undefined
  const retryable = error && typeof error === "object" && typeof error.retryable === "boolean"
    ? error.retryable
    : undefined
  const details = error && typeof error === "object" && error.details
    && typeof error.details === "object" && !Array.isArray(error.details)
    ? error.details
    : undefined
  return {
    content: [textBlock(message)],
    structuredContent: {
      error: message,
      ...(code ? { code } : {}),
      ...(retryable !== undefined ? { retryable } : {}),
      ...(details ? { details } : {}),
    },
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

function createBrowserGateway() {
  const worker = new Worker(browserGatewayWorkerPath, {
    workerData: {
      protocolVersion: process.env.ANYBOX_BROWSER_IPC_PROTOCOL_VERSION,
      runtimeEndpoint: process.env.ANYBOX_BROWSER_IPC_RUNTIME_ENDPOINT,
      brokerInstanceID: process.env.ANYBOX_BROWSER_IPC_BROKER_INSTANCE_ID,
      runtimeProof: process.env.ANYBOX_BROWSER_IPC_RUNTIME_PROOF,
      clientVersion: "0.4.0",
    },
  })
  const postWorkerMessage = worker.postMessage.bind(worker)
  const pending = new Map()
  let nextID = 1
  let readyResolve
  let readyReject
  let settled = false
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve
    readyReject = reject
  })

  const rejectPending = (error) => {
    for (const request of pending.values()) request.reject(error)
    pending.clear()
  }

  worker.on("message", (message) => {
    if (message?.type === "ready") {
      settled = true
      readyResolve()
      return
    }
    const request = pending.get(message?.id)
    if (!request) return
    pending.delete(message.id)
    if (message.ok) request.resolve(message.data)
    else {
      const error = new Error(message.error || "Chrome browser gateway request failed.")
      if (typeof message.code === "string") error.code = message.code
      if (typeof message.retryable === "boolean") error.retryable = message.retryable
      if (message.details && typeof message.details === "object" && !Array.isArray(message.details)) {
        error.details = message.details
      }
      request.reject(error)
    }
  })
  worker.on("error", (error) => {
    if (!settled) {
      settled = true
      readyReject(error)
    }
    rejectPending(error)
  })
  worker.on("exit", (code) => {
    const error = new Error(`Chrome browser gateway stopped with exit code ${code}.`)
    if (!settled) {
      settled = true
      readyReject(error)
    }
    rejectPending(error)
  })

  const callWorker = (message) => {
    return new Promise((resolve, reject) => {
      const id = nextID
      nextID += 1
      pending.set(id, { resolve, reject })
      try {
        postWorkerMessage({ id, ...message })
      } catch (error) {
        pending.delete(id)
        reject(error)
      }
    })
  }

  return {
    ready,
    request(request) {
      return callWorker({ request })
    },
    reset() {
      return callWorker({ type: "reset" })
    },
  }
}

const getBrowserRequestContext =
  browserRequestContext.getStore.bind(browserRequestContext)
const runWithBrowserRequestContext =
  browserRequestContext.run.bind(browserRequestContext)

function clearSensitiveRuntimeEnvironment() {
  delete process.env.ANYBOX_BROWSER_TRUSTED_TOKEN
  delete process.env.ANYBOX_BROWSER_TRANSPORT_TOKEN
  delete process.env.ANYBOX_BROWSER_IPC_PROTOCOL_VERSION
  delete process.env.ANYBOX_BROWSER_IPC_TRANSPORT
  delete process.env.ANYBOX_BROWSER_IPC_RUNTIME_ENDPOINT
  delete process.env.ANYBOX_BROWSER_IPC_NATIVE_ENDPOINT
  delete process.env.ANYBOX_BROWSER_IPC_BOOTSTRAP_PATH
  delete process.env.ANYBOX_BROWSER_IPC_BROKER_INSTANCE_ID
  delete process.env.ANYBOX_BROWSER_IPC_RUNTIME_PROOF
}

function prepareRuntime() {
  runtimeReadyPromise ??= Promise.all([
    nativeMessagingHostReady,
    loadBrowserClient(),
    browserGateway.ready,
  ]).then(([, browserClient]) => {
    return browserClient
  }).finally(() => {
    clearSensitiveRuntimeEnvironment()
  })
  return runtimeReadyPromise
}

function installBrowserRuntime(browserClient, options = {}) {
  return browserClient.setupBrowserRuntime({
    ...options,
    transport: (request) => browserGateway.request({
      ...request,
      ...(request.type === "command" && getBrowserRequestContext()
        ? { context: getBrowserRequestContext() }
        : {}),
    }),
  })
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
  if (
    imageLike
    && typeof imageLike === "object"
    && typeof imageLike.data === "string"
    && imageLike.data
  ) {
    return {
      type: "image",
      mimeType: imageLike.mime || imageLike.mimeType || "image/png",
      data: imageLike.data,
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
  const browserClient = await prepareRuntime()
  sandbox.setupBrowserRuntime = (options = {}) => installBrowserRuntime(browserClient, options)
  if (!sandbox.agent) await installBrowserRuntime(browserClient, { globals: sandbox })

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

async function callTool(name, args, requestContext) {
  const normalizedName = {
    node_repl_js: "js",
    node_repl_reset: "js_reset",
    node_repl_add_node_module_dir: "js_add_node_module_dir",
  }[name] || name

  if (normalizedName === "js_reset") {
    await browserGateway.reset()
    resetKernel()
    return textResult("Node REPL reset.", { reset: true })
  }

  if (normalizedName === "js_add_node_module_dir") {
    const added = addNodeModuleDir(args && args.path)
    return textResult(`Added node_modules directory: ${added}`, { path: added })
  }

  if (normalizedName === "js") {
    const code = args && typeof args.code === "string" ? args.code : ""
    if (!code.trim()) throw new Error("js requires code.")
    return runWithBrowserRequestContext(
      requestContext,
      () => runJavaScript(code, timeoutMs(args && args.timeoutMs)),
    )
  }

  throw new Error(`Unknown tool: ${name}`)
}

function readRequestContext(message) {
  const meta = message?.params?._meta
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return undefined
  const context = {}
  const aliases = {
    sessionID: ["sessionID", "sessionId", "anybox/sessionID"],
    messageID: ["messageID", "messageId", "anybox/messageID"],
    toolCallID: ["toolCallID", "toolCallId", "anybox/toolCallID"],
  }
  for (const [target, keys] of Object.entries(aliases)) {
    const value = keys.map((key) => meta[key]).find(
      (candidate) => typeof candidate === "string" && candidate.trim(),
    )
    if (typeof value === "string") context[target] = value.trim()
  }
  return Object.keys(context).length > 0 ? context : undefined
}

resetKernel()

const rl = readline.createInterface({ input: process.stdin })

rl.on("line", (line) => {
  let requestID = null
  void (async () => {
    if (!line.trim()) return
    const message = JSON.parse(line)
    requestID = message.id ?? null

    if (message.method === "initialize") {
      await prepareRuntime()
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "anybox-chrome-node-repl", version: "0.4.0" },
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
        const result = await callTool(
          message.params && message.params.name,
          message.params && message.params.arguments,
          readRequestContext(message),
        )
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
      id: requestID,
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : String(error),
      },
    })
  })
})

rl.on("close", () => {
  void browserGateway.reset().finally(() => process.exit(0))
})
