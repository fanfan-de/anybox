#!/usr/bin/env node

const readline = require("node:readline")
const os = require("node:os")
const path = require("node:path")
const { createRequire } = require("node:module")
const { AsyncLocalStorage } = require("node:async_hooks")
const Module = require("node:module")

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_TIMEOUT_MS = 120_000
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

let sandbox
let writes
let images
let responseMeta
let outboundRequestSequence = 0
let lastRequestContext
const nodeModuleDirs = []
const requestContext = new AsyncLocalStorage()
const executionTimeoutContext = new AsyncLocalStorage()
const pendingClientRequests = new Map()
const lifecycleHooks = new Set()
const afterSubmittedCodeHooks = new Set()

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

function requestClient(method, params, timeout = MAX_TIMEOUT_MS) {
  const id = `anybox-node-repl:${++outboundRequestSequence}`
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingClientRequests.delete(id)
      const error = new Error(`${method} timed out after ${timeout}ms.`)
      error.code = "ELICITATION_TIMEOUT"
      reject(error)
    }, timeout)
    timer.unref?.()
    pendingClientRequests.set(id, {
      resolve(value) {
        clearTimeout(timer)
        resolve(value)
      },
      reject(error) {
        clearTimeout(timer)
        reject(error)
      },
    })
    send({ jsonrpc: "2.0", id, method, params })
  })
}

function settleClientResponse(message) {
  if (!message || message.method !== undefined || message.id === undefined) {
    return false
  }
  const pending = pendingClientRequests.get(message.id)
  if (!pending) return false
  pendingClientRequests.delete(message.id)
  if (message.error) {
    const error = new Error(
      typeof message.error.message === "string"
        ? message.error.message
        : "MCP client request failed.",
    )
    error.code = "ELICITATION_FAILED"
    pending.reject(error)
  } else {
    pending.resolve(message.result)
  }
  return true
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
  for (const key of ["sessionID", "turnID", "messageID", "toolCallID"]) {
    if (typeof context[key] === "string" && context[key]) result[key] = context[key]
  }
  return Object.keys(result).length > 0 ? Object.freeze(result) : undefined
}

async function runHookSet(hooks, payload) {
  const failures = []
  for (const hook of [...hooks]) {
    try {
      await hook(payload)
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error))
    }
  }
  if (failures.length > 0) {
    process.stderr.write(`[anybox-node-repl] lifecycle hook failed: ${failures.join("; ")}\n`)
  }
}

async function emitLifecycle(type, context = lastRequestContext, detail) {
  const effectiveContext = lastRequestContext || context
    ? { ...(lastRequestContext || {}), ...(context || {}) }
    : undefined
  const payload = Object.freeze({
    type,
    context: effectiveContext
      ? Object.freeze({ ...effectiveContext })
      : undefined,
    detail,
    timestamp: Date.now(),
  })
  if (effectiveContext) {
    await requestContext.run(
      effectiveContext,
      () => runHookSet(lifecycleHooks, payload),
    )
    return
  }
  await runHookSet(lifecycleHooks, payload)
}

async function notifyContextTransition(nextContext) {
  const previous = lastRequestContext
  if (
    previous?.turnID
    && nextContext?.turnID
    && previous.turnID !== nextContext.turnID
  ) {
    await emitLifecycle("turn-end", previous, { nextTurnID: nextContext.turnID })
  }
  if (
    previous?.sessionID
    && nextContext?.sessionID
    && previous.sessionID !== nextContext.sessionID
  ) {
    await emitLifecycle("session-end", previous, {
      nextSessionID: nextContext.sessionID,
    })
  }
  lastRequestContext = nextContext ? { ...nextContext } : undefined
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
    async requestPermission(input) {
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new Error("requestPermission expects an object.")
      }
      const context = publicRequestMeta()
      if (!context?.sessionID || !context?.turnID || !context?.messageID || !context?.toolCallID) {
        const error = new Error(
          "requestPermission requires sessionID, turnID, messageID, and toolCallID metadata.",
        )
        error.code = "PERMISSION_CONTEXT_REQUIRED"
        throw error
      }
      const timeout = timeoutMs(input.timeoutMs ?? MAX_TIMEOUT_MS)
      const execution = executionTimeoutContext.getStore()
      execution?.pause()
      let result
      try {
        result = await requestClient("elicitation/create", {
          mode: "form",
          message: typeof input.message === "string" && input.message.trim()
            ? input.message.trim().slice(0, 1_000)
            : "Allow this action?",
          requestedSchema: {
            type: "object",
            properties: {
              decision: {
                type: "string",
                title: "Decision",
                oneOf: [
                  { const: "deny", title: "Deny" },
                  { const: "allow-once", title: "Allow once" },
                  { const: "allow-session", title: "Allow for this session" },
                ],
                default: "allow-once",
              },
            },
            required: ["decision"],
          },
          _meta: {
            "anybox/permission": {
              ...input,
              timeoutMs: timeout,
              continuation: "in-process",
              context,
            },
          },
        }, timeout)
      } finally {
        execution?.resume()
      }
      if (!result || typeof result !== "object") {
        throw new Error("The permission client returned an invalid response.")
      }
      const content = result.content && typeof result.content === "object"
        ? result.content
        : {}
      const decision = result.action === "accept"
        && ["allow-once", "allow-session"].includes(content.decision)
        ? content.decision
        : "deny"
      return Object.freeze({
        allowed: decision !== "deny",
        decision,
        action: result.action,
        grantID: typeof content.grantID === "string" ? content.grantID : undefined,
        authorization: typeof content.authorization === "string"
          ? content.authorization
          : undefined,
      })
    },
    addLifecycleHook(hook) {
      if (typeof hook !== "function") {
        throw new Error("addLifecycleHook expects a function.")
      }
      lifecycleHooks.add(hook)
      return () => lifecycleHooks.delete(hook)
    },
    addAfterSubmittedCodeHook(hook) {
      if (typeof hook !== "function") {
        throw new Error("addAfterSubmittedCodeHook expects a function.")
      }
      afterSubmittedCodeHooks.add(hook)
      return () => afterSubmittedCodeHooks.delete(hook)
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

function executionTimeoutBudget(ms) {
  let remaining = ms
  let lastActiveAt = Date.now()
  let pauseDepth = 0
  let changed
  const consume = () => {
    if (pauseDepth > 0) return
    const current = Date.now()
    remaining -= current - lastActiveAt
    lastActiveAt = current
  }
  return {
    remaining() {
      consume()
      return remaining
    },
    pause() {
      consume()
      pauseDepth += 1
      changed?.()
    },
    resume() {
      if (pauseDepth === 0) return
      pauseDepth -= 1
      lastActiveAt = Date.now()
      changed?.()
    },
    paused() {
      return pauseDepth > 0
    },
    onChanged(callback) {
      changed = callback
    },
  }
}

async function runWithTimeout(promise, ms, budget) {
  let timer
  let settled = false
  const timeoutPromise = new Promise((_, reject) => {
    const schedule = () => {
      clearTimeout(timer)
      if (settled || budget.paused()) return
      const remaining = budget.remaining()
      if (remaining <= 0) {
        reject(new Error(`Execution timed out after ${ms}ms.`))
        return
      }
      timer = setTimeout(schedule, remaining)
    }
    budget.onChanged(schedule)
    schedule()
  })
  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    settled = true
    clearTimeout(timer)
    budget.onChanged(undefined)
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
  let value
  let failure
  try {
    const budget = executionTimeoutBudget(ms)
    value = await runWithTimeout(
      executionTimeoutContext.run(
        budget,
        () => fn.call(sandbox, sandbox, sandbox.nodeRepl),
      ),
      ms,
      budget,
    )
  } catch (error) {
    failure = error
    throw error
  } finally {
    await runHookSet(afterSubmittedCodeHooks, Object.freeze({
      context: publicRequestMeta(),
      ok: !failure,
      error: failure instanceof Error ? failure.message : failure ? String(failure) : undefined,
      timestamp: Date.now(),
    }))
  }

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
    await emitLifecycle("reset")
    lifecycleHooks.clear()
    afterSubmittedCodeHooks.clear()
    lastRequestContext = undefined
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
    await notifyContextTransition(context)
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
    turnID: ["turnID", "turnId", "anybox/turnID"],
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
    if (settleClientResponse(message)) return

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

    if (message.method === "notifications/anybox/lifecycle") {
      const params = message.params && typeof message.params === "object"
        ? message.params
        : {}
      const context = params.context && typeof params.context === "object"
        ? params.context
        : undefined
      await emitLifecycle(
        typeof params.type === "string" ? params.type : "turn-end",
        context,
        params.detail,
      )
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
  void emitLifecycle("transport-close").finally(() => {
    for (const pending of pendingClientRequests.values()) {
      const error = new Error("MCP transport closed during an in-process request.")
      error.code = "CONNECTION_CLOSED"
      pending.reject(error)
    }
    pendingClientRequests.clear()
    process.exit(0)
  })
})
