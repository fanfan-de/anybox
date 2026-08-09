#!/usr/bin/env node

"use strict"

const os = require("node:os")
const path = require("node:path")
const { createRequire } = require("node:module")
const { AsyncLocalStorage } = require("node:async_hooks")
const Module = require("node:module")

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_TIMEOUT_MS = 120_000
const MAX_ERROR_MESSAGE_CHARS = 4_096
const MAX_RESULT_DEPTH = 256
const MAX_RESULT_JSON_BYTES = 8 * 1024 * 1024
const MAX_RESULT_NODES = 250_000
const MAX_TEXT_OUTPUT_CHARS = 64 * 1024
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const OMIT_JSON_PROPERTY = Symbol("omit-json-property")

let sandbox
let writes
let images
let responseMeta
let lastRequestContext
let activeCommandID
let outboundRequestSequence = 0
const nodeModuleDirs = []
const requestContext = new AsyncLocalStorage()
const pendingSupervisorRequests = new Map()
const lifecycleHooks = new Set()
const afterSubmittedCodeHooks = new Set()

function send(payload) {
  if (!process.connected || typeof process.send !== "function") return false
  try {
    process.send(payload)
    return true
  } catch {
    return false
  }
}

function serializedError(error) {
  let rawMessage = "Node REPL execution failed."
  let code
  let retryable
  let rawDetails
  try {
    rawMessage = error instanceof Error ? error.message : String(error)
  } catch {
    // Keep the stable fallback when an exotic thrown value traps inspection.
  }
  try {
    if (error && typeof error === "object") {
      code = typeof error.code === "string" ? error.code : undefined
      retryable = typeof error.retryable === "boolean" ? error.retryable : undefined
      rawDetails = error.details
    }
  } catch {
    // Error metadata is optional and must never break the IPC response.
  }
  const message = truncateText(rawMessage, MAX_ERROR_MESSAGE_CHARS)
  let details
  if (
    rawDetails
    && typeof rawDetails === "object"
    && !Array.isArray(rawDetails)
  ) {
    try {
      details = normalizeJsonPayload(rawDetails)
    } catch {
      details = { omitted: "Error details were not JSON-serializable." }
    }
  }
  return {
    message,
    ...(code ? { code } : {}),
    ...(retryable !== undefined ? { retryable } : {}),
    ...(details ? { details } : {}),
  }
}

function requestSupervisor(method, params, timeout = MAX_TIMEOUT_MS) {
  const id = `kernel:${process.pid}:${++outboundRequestSequence}`
  return new Promise((resolve, reject) => {
    pendingSupervisorRequests.set(id, { resolve, reject })
    if (!send({
      type: "bridge-request",
      id,
      commandID: activeCommandID,
      method,
      params,
      timeoutMs: timeout,
    })) {
      pendingSupervisorRequests.delete(id)
      const error = new Error("Node REPL supervisor IPC is unavailable.")
      error.code = "CONNECTION_CLOSED"
      reject(error)
    }
  })
}

function settleSupervisorResponse(message) {
  if (!message || message.type !== "bridge-response" || typeof message.id !== "string") {
    return false
  }
  const pending = pendingSupervisorRequests.get(message.id)
  if (!pending) return true
  pendingSupervisorRequests.delete(message.id)
  if (message.error) {
    const error = new Error(
      typeof message.error.message === "string"
        ? message.error.message
        : "Node REPL supervisor request failed.",
    )
    if (typeof message.error.code === "string") error.code = message.error.code
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

function printable(value) {
  if (value === undefined) return ""
  if (typeof value === "string") return truncateText(value, MAX_TEXT_OUTPUT_CHARS)
  try {
    return truncateText(JSON.stringify(value, null, 2), MAX_TEXT_OUTPUT_CHARS)
  } catch {
    return truncateText(String(value), MAX_TEXT_OUTPUT_CHARS)
  }
}

function truncateText(value, limit) {
  const text = String(value)
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}\n… [${text.length - limit} characters omitted]`
}

function jsonPath(pathPrefix, key) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(key)
    ? `${pathPrefix}.${key}`
    : `${pathPrefix}[${JSON.stringify(key)}]`
}

function resultSerializationError(message, details, code = "RESULT_NOT_JSON_SERIALIZABLE") {
  const error = new Error(message)
  error.code = code
  error.details = details
  return error
}

function assertJsonPayloadSize(value) {
  const encoded = JSON.stringify(value)
  const bytes = Buffer.byteLength(encoded, "utf8")
  if (bytes > MAX_RESULT_JSON_BYTES) {
    throw resultSerializationError(
      `Node REPL result is ${bytes} bytes, exceeding the ${MAX_RESULT_JSON_BYTES} byte JSON limit.`,
      { bytes, limit: MAX_RESULT_JSON_BYTES, kind: "bytes" },
      "RESULT_LIMIT_EXCEEDED",
    )
  }
}

function normalizeJsonPayload(value) {
  const seen = new WeakMap()
  let nodeCount = 0

  const visit = (current, currentPath, depth, location) => {
    nodeCount += 1
    if (nodeCount > MAX_RESULT_NODES) {
      throw resultSerializationError(
        `Node REPL result exceeded the ${MAX_RESULT_NODES} value limit at ${currentPath}.`,
        { path: currentPath, limit: MAX_RESULT_NODES, kind: "nodes" },
        "RESULT_LIMIT_EXCEEDED",
      )
    }
    if (depth > MAX_RESULT_DEPTH) {
      throw resultSerializationError(
        `Node REPL result exceeded the maximum JSON depth of ${MAX_RESULT_DEPTH} at ${currentPath}.`,
        { path: currentPath, limit: MAX_RESULT_DEPTH, kind: "depth" },
        "RESULT_LIMIT_EXCEEDED",
      )
    }

    if (current === null || typeof current === "string" || typeof current === "boolean") {
      return current
    }
    if (typeof current === "number") {
      if (Number.isFinite(current)) return current
      throw resultSerializationError(
        `Node REPL result contains a non-finite number at ${currentPath}.`,
        { path: currentPath, type: String(current) },
      )
    }
    if (typeof current === "undefined" || typeof current === "function" || typeof current === "symbol") {
      if (location === "object") return OMIT_JSON_PROPERTY
      if (location === "array") return null
      return null
    }
    if (typeof current === "bigint") {
      throw resultSerializationError(
        `Node REPL result contains a BigInt at ${currentPath}; convert it to a string or number before returning.`,
        { path: currentPath, type: "bigint" },
      )
    }

    const previousPath = seen.get(current)
    if (previousPath) {
      throw resultSerializationError(
        `Node REPL result contains a circular reference at ${currentPath}.`,
        { path: currentPath, referencePath: previousPath, type: "circular" },
      )
    }
    seen.set(current, currentPath)
    try {
      if (current instanceof Map || current instanceof Set || current instanceof WeakMap || current instanceof WeakSet) {
        throw resultSerializationError(
          `Node REPL result contains unsupported ${current.constructor.name} data at ${currentPath}; convert it to a JSON object or array before returning.`,
          { path: currentPath, type: current.constructor.name },
        )
      }
      if (Array.isArray(current)) {
        return current.map((item, index) => visit(item, `${currentPath}[${index}]`, depth + 1, "array"))
      }
      if (ArrayBuffer.isView(current) && !Buffer.isBuffer(current)) {
        if (current instanceof DataView) {
          throw resultSerializationError(
            `Node REPL result contains unsupported DataView data at ${currentPath}.`,
            { path: currentPath, type: "DataView" },
          )
        }
        return Array.from(current, (item, index) => visit(
          item,
          `${currentPath}[${index}]`,
          depth + 1,
          "array",
        ))
      }
      if (typeof current.toJSON === "function") {
        let jsonValue
        try {
          jsonValue = current.toJSON()
        } catch (error) {
          throw resultSerializationError(
            `Node REPL result toJSON failed at ${currentPath}: ${error instanceof Error ? error.message : String(error)}`,
            { path: currentPath, type: current.constructor?.name || "object" },
          )
        }
        return visit(jsonValue, currentPath, depth + 1, location)
      }

      const normalized = {}
      for (const key of Object.keys(current)) {
        const propertyPath = jsonPath(currentPath, key)
        let propertyValue
        try {
          propertyValue = current[key]
        } catch (error) {
          throw resultSerializationError(
            `Node REPL could not read result property ${propertyPath}: ${error instanceof Error ? error.message : String(error)}`,
            { path: propertyPath, type: "property-access" },
          )
        }
        const property = visit(propertyValue, propertyPath, depth + 1, "object")
        if (property !== OMIT_JSON_PROPERTY) normalized[key] = property
      }
      return normalized
    } catch (error) {
      if (
        error
        && typeof error === "object"
        && (
          error.code === "RESULT_NOT_JSON_SERIALIZABLE"
          || error.code === "RESULT_LIMIT_EXCEEDED"
        )
      ) {
        throw error
      }
      throw resultSerializationError(
        `Node REPL could not inspect the result at ${currentPath}: ${error instanceof Error ? error.message : String(error)}`,
        { path: currentPath, type: "object-inspection" },
      )
    } finally {
      seen.delete(current)
    }
  }

  const normalized = visit(value, "$", 0, "root")
  assertJsonPayloadSize(normalized)
  return normalized
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

function publicContext(context) {
  if (!context) return undefined
  const result = {}
  for (const key of ["sessionID", "turnID", "messageID", "toolCallID"]) {
    if (typeof context[key] === "string" && context[key]) result[key] = context[key]
  }
  return Object.keys(result).length > 0 ? result : undefined
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
    process.stderr.write(`[anybox-node-repl-kernel] lifecycle hook failed: ${failures.join("; ")}\n`)
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
  lastRequestContext = publicContext(nextContext)
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
      const result = await requestSupervisor("elicitation/create", {
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

async function runJavaScript(code) {
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
    value = await fn.call(sandbox, sandbox, sandbox.nodeRepl)
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

  const structuredContent = {
    result: normalizeJsonPayload(value === undefined ? null : value),
    writes,
    imageCount: images.length,
  }
  const normalizedResponseMeta = responseMeta
    ? normalizeJsonPayload(responseMeta)
    : undefined
  assertJsonPayloadSize({ structuredContent, responseMeta: normalizedResponseMeta ?? null })
  const textParts = [...structuredContent.writes]
  const printed = printable(structuredContent.result)
  if (printed) textParts.push(printed)
  const content = textParts.length > 0
    ? [textBlock(truncateText(textParts.join("\n"), MAX_TEXT_OUTPUT_CHARS))]
    : []
  content.push(...images)
  if (content.length === 0) content.push(textBlock(""))

  return {
    content,
    structuredContent,
    ...(normalizedResponseMeta ? { _meta: normalizedResponseMeta } : {}),
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
    return requestContext.run(context, () => runJavaScript(code))
  }

  throw new Error(`Unknown tool: ${name}`)
}

async function handleCommand(message) {
  activeCommandID = message.id
  try {
    const result = message.command === "call-tool"
      ? await callTool(message.name, message.args, message.context)
      : message.command === "lifecycle"
        ? await emitLifecycle(message.lifecycle?.type, message.lifecycle?.context, message.lifecycle?.detail)
        : (() => { throw new Error(`Unknown kernel command: ${message.command}`) })()
    if (!send({ type: "command-result", id: message.id, result: result ?? null })) {
      send({
        type: "command-result",
        id: message.id,
        error: serializedError(new Error("Node REPL result is not IPC-serializable.")),
      })
    }
  } catch (error) {
    send({ type: "command-result", id: message.id, error: serializedError(error) })
  } finally {
    activeCommandID = undefined
  }
}

for (const dir of (() => {
  try {
    const parsed = JSON.parse(process.env.ANYBOX_NODE_REPL_MODULE_DIRS_JSON || "[]")
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
})()) {
  addNodeModuleDir(dir)
}
delete process.env.ANYBOX_NODE_REPL_MODULE_DIRS_JSON
resetKernel()

let commandTail = Promise.resolve()
process.on("message", (message) => {
  if (settleSupervisorResponse(message)) return
  if (!message || message.type !== "command" || typeof message.id !== "string") return
  commandTail = commandTail.then(() => handleCommand(message))
})

process.on("disconnect", () => {
  const error = new Error("Node REPL supervisor disconnected.")
  error.code = "CONNECTION_CLOSED"
  for (const pending of pendingSupervisorRequests.values()) pending.reject(error)
  pendingSupervisorRequests.clear()
  process.exit(0)
})

send({ type: "ready", pid: process.pid })
