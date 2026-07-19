#!/usr/bin/env node

const readline = require("node:readline")
const os = require("node:os")
const path = require("node:path")
const { createRequire } = require("node:module")
const { AsyncLocalStorage } = require("node:async_hooks")
const Module = require("node:module")

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_TIMEOUT_MS = 120_000
const HOST_REQUEST_TIMEOUT_MS = 120_000
const HOST_REQUEST_METHOD = "anybox/node-repl/host-request"
const HOST_REQUEST_TOKEN_META_KEY = "anybox/hostRequestToken"
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

let sandbox
let writes
let images
let responseMeta
let nextHostRequestID = 1
const nodeModuleDirs = []
const requestContext = new AsyncLocalStorage()
const pendingHostRequests = new Map()

const tools = [
  {
    name: "js",
    title: "Node REPL JavaScript",
    description: "Run JavaScript in a persistent general-purpose Node.js environment.",
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
    title: "Reset Node REPL",
    description: "Reset the persistent Node.js environment.",
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
    description: "Add a node_modules directory to CommonJS module resolution for later calls.",
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
  const input = String(dir || "").trim()
  if (!input) throw new Error("path is required.")
  const normalized = path.resolve(input)
  if (!nodeModuleDirs.includes(normalized)) nodeModuleDirs.push(normalized)
  process.env.NODE_PATH = nodeModuleDirs.join(path.delimiter)
  Module._initPaths()
  return normalized
}

function publicRequestMeta() {
  const context = requestContext.getStore()
  if (!context) return undefined
  const result = {}
  for (const key of ["sessionID", "messageID", "toolCallID"]) {
    if (typeof context[key] === "string" && context[key]) result[key] = context[key]
  }
  return Object.keys(result).length > 0 ? Object.freeze(result) : undefined
}

function hostError(error, fallbackMessage = "Anybox host request failed.") {
  const result = new Error(
    error && typeof error === "object" && typeof error.message === "string"
      ? error.message
      : fallbackMessage,
  )
  if (error && typeof error === "object") {
    if (typeof error.code === "string") result.code = error.code
    if (typeof error.retryable === "boolean") result.retryable = error.retryable
    if (error.details && typeof error.details === "object" && !Array.isArray(error.details)) {
      result.details = error.details
    }
  }
  return result
}

function requestHost(service, request) {
  if (typeof service !== "string" || !service.trim()) {
    return Promise.reject(new Error("requestHost requires a service name."))
  }
  const context = requestContext.getStore()
  if (!context?.hostRequestToken) {
    return Promise.reject(
      new Error("Host services are available only while an Anybox Node REPL tool call is running."),
    )
  }

  const id = `host-${process.pid}-${nextHostRequestID}`
  nextHostRequestID += 1
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingHostRequests.delete(id)
      const error = new Error(
        `Anybox host service '${service.trim()}' timed out after ${HOST_REQUEST_TIMEOUT_MS}ms.`,
      )
      error.code = "DEADLINE_EXCEEDED"
      error.retryable = true
      reject(error)
    }, HOST_REQUEST_TIMEOUT_MS)
    pendingHostRequests.set(id, {
      resolve(value) {
        clearTimeout(timer)
        resolve(value)
      },
      reject(error) {
        clearTimeout(timer)
        reject(error)
      },
    })
    send({
      jsonrpc: "2.0",
      id,
      method: HOST_REQUEST_METHOD,
      params: {
        service: service.trim(),
        request,
        token: context.hostRequestToken,
      },
    })
  }).then((result) => {
    if (result && typeof result === "object" && result.ok === true) {
      return result.data
    }
    if (result && typeof result === "object" && result.ok === false) {
      throw hostError(result.error)
    }
    throw hostError(undefined, "Anybox host returned an invalid response.")
  })
}

function resetKernel() {
  writes = []
  images = []
  responseMeta = undefined
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
  const nodeRepl = {
    cwd: process.cwd(),
    homeDir: os.homedir(),
    tmpDir: os.tmpdir(),
    nodeModuleDirs,
    addNodeModuleDir,
    requestHost,
    write(text) {
      writes.push(String(text))
    },
    setResponseMeta(value) {
      if (value === undefined || value === null) {
        responseMeta = undefined
        return
      }
      if (typeof value !== "object" || Array.isArray(value)) {
        throw new Error("setResponseMeta expects an object.")
      }
      responseMeta = { ...value }
    },
    async emitImage(imageLike) {
      const image = normalizeImage(imageLike)
      images.push(image)
      return image
    },
  }
  Object.defineProperty(nodeRepl, "requestMeta", {
    enumerable: true,
    get: publicRequestMeta,
  })
  sandbox.nodeRepl = Object.freeze(nodeRepl)
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
  writes = []
  images = []
  responseMeta = undefined
  const fn = new AsyncFunction(
    "sandbox",
    "nodeRepl",
    `with (sandbox) { return await (async () => {\n${code}\n})() }`,
  )
  const value = await runWithTimeout(
    fn.call(sandbox, sandbox, sandbox.nodeRepl),
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
    ...(responseMeta ? { _meta: responseMeta } : {}),
    isError: false,
  }
}

async function callTool(name, args, context) {
  const normalizedName = {
    node_repl_js: "js",
    node_repl_reset: "js_reset",
    node_repl_add_node_module_dir: "js_add_node_module_dir",
  }[name] || name

  if (normalizedName === "js_reset") {
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
    return requestContext.run(
      context,
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
  const token = meta[HOST_REQUEST_TOKEN_META_KEY]
  if (typeof token === "string" && token) context.hostRequestToken = token
  return Object.keys(context).length > 0 ? context : undefined
}

function handleResponse(message) {
  if (message?.method !== undefined || message?.id === undefined) return false
  const pending = pendingHostRequests.get(String(message.id))
  if (!pending) return false
  pendingHostRequests.delete(String(message.id))
  if (message.error) {
    pending.reject(hostError(message.error))
  } else {
    pending.resolve(message.result)
  }
  return true
}

resetKernel()

const rl = readline.createInterface({ input: process.stdin })

rl.on("line", (line) => {
  let requestID = null
  void (async () => {
    if (!line.trim()) return
    const message = JSON.parse(line)
    if (handleResponse(message)) return
    requestID = message.id ?? null

    if (message.method === "initialize") {
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
  const error = new Error("Anybox host connection closed.")
  for (const pending of pendingHostRequests.values()) pending.reject(error)
  pendingHostRequests.clear()
  process.exit(0)
})
