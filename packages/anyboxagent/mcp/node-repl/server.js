#!/usr/bin/env node

"use strict"

const readline = require("node:readline")
const path = require("node:path")
const { fork, spawn } = require("node:child_process")

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_TIMEOUT_MS = 120_000
const KERNEL_CONTROL_TIMEOUT_MS = 30_000
const KERNEL_START_TIMEOUT_MS = 5_000
const KERNEL_EXIT_TIMEOUT_MS = 2_000
const KERNEL_PATH = path.resolve(__dirname, "kernel.js")

let outboundRequestSequence = 0
let kernelCommandSequence = 0
let kernelGeneration = 0
let kernel
let spawningKernel
let startingKernel
let recoveryPromise
let activeKernelCommand
let serialTail = Promise.resolve()
let shuttingDown = false
let shutdownPromise
const nodeModuleDirs = []
const pendingClientRequests = new Map()
const cancelledRequestIDs = new Set()
const pendingToolRequestIDs = new Set()

const tools = [
  {
    name: "js",
    title: "Node REPL JavaScript",
    description: "Run JavaScript in a persistent general-purpose Node.js kernel. Code runs as an async function body; use an explicit return (or nodeRepl.write) to expose values. A timeout or cancellation terminates and resets the kernel.",
    inputSchema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "JavaScript source to run. Top-level await is supported.",
        },
        timeoutMs: {
          type: "number",
          description: "Execution timeout in milliseconds. Permission decision time is excluded.",
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
  if (shuttingDown || process.stdout.destroyed) return
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

function textBlock(text) {
  return { type: "text", text }
}

function errorResult(error) {
  const message = error instanceof Error ? error.message : String(error)
  const code = error && typeof error === "object" && typeof error.code === "string"
    ? error.code
    : undefined
  const status = error && typeof error === "object" && error.status === "cancelled"
    ? "cancelled"
    : "error"
  const runtimeReset = error && typeof error === "object" && typeof error.runtimeReset === "boolean"
    ? error.runtimeReset
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
      status,
      error: message,
      ...(runtimeReset !== undefined ? { runtimeReset } : {}),
      ...(code ? { code } : {}),
      ...(retryable !== undefined ? { retryable } : {}),
      ...(details ? { details } : {}),
    },
    isError: true,
  }
}

function runtimeError(message, options = {}) {
  const error = new Error(message)
  if (typeof options.code === "string") error.code = options.code
  if (options.status === "cancelled") error.status = "cancelled"
  if (typeof options.runtimeReset === "boolean") error.runtimeReset = options.runtimeReset
  if (typeof options.retryable === "boolean") error.retryable = options.retryable
  if (options.details && typeof options.details === "object") error.details = options.details
  return error
}

function timeoutMs(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TIMEOUT_MS
  return Math.min(Math.trunc(parsed), MAX_TIMEOUT_MS)
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

function requestKey(id) {
  return `${typeof id}:${String(id)}`
}

function requestClient(method, params, timeout = MAX_TIMEOUT_MS) {
  const id = `anybox-node-repl:${++outboundRequestSequence}`
  const promise = new Promise((resolve, reject) => {
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
  return { id, promise }
}

function cancelClientRequest(id, error) {
  const pending = pendingClientRequests.get(id)
  if (!pending) return
  pendingClientRequests.delete(id)
  pending.reject(error)
  send({
    jsonrpc: "2.0",
    method: "notifications/cancelled",
    params: { requestId: id, reason: error.message },
  })
}

function settleClientResponse(message) {
  if (!message || message.method !== undefined || message.id === undefined) return false
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

function executionBudget(ms, onTimeout) {
  let remaining = ms
  let activeSince = Date.now()
  let pauseDepth = 0
  let timer
  let stopped = false

  const consume = () => {
    if (pauseDepth > 0 || stopped) return
    const now = Date.now()
    remaining -= now - activeSince
    activeSince = now
  }
  const schedule = () => {
    clearTimeout(timer)
    if (stopped || pauseDepth > 0) return
    consume()
    if (remaining <= 0) {
      queueMicrotask(onTimeout)
      return
    }
    timer = setTimeout(onTimeout, remaining)
  }

  schedule()
  return {
    pause() {
      if (stopped) return
      consume()
      pauseDepth += 1
      clearTimeout(timer)
    },
    resume() {
      if (stopped || pauseDepth === 0) return
      pauseDepth -= 1
      activeSince = Date.now()
      if (pauseDepth === 0) schedule()
    },
    stop() {
      stopped = true
      clearTimeout(timer)
    },
  }
}

function waitForExit(child, timeout) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise((resolve) => {
    let timer
    const onExit = () => {
      clearTimeout(timer)
      resolve(true)
    }
    child.once("exit", onExit)
    timer = setTimeout(() => {
      child.removeListener("exit", onExit)
      resolve(false)
    }, timeout)
    timer.unref?.()
  })
}

async function forceKillWindowsTree(pid) {
  await new Promise((resolve) => {
    const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    })
    const timer = setTimeout(() => {
      killer.kill("SIGKILL")
      resolve()
    }, KERNEL_EXIT_TIMEOUT_MS)
    timer.unref?.()
    killer.once("error", () => {
      clearTimeout(timer)
      resolve()
    })
    killer.once("exit", () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

async function terminateKernel(runtime) {
  if (!runtime) return true
  const child = runtime.child
  if (child.exitCode !== null || child.signalCode !== null) return true
  if (process.platform === "win32" && child.pid) {
    await forceKillWindowsTree(child.pid)
  } else if (child.pid) {
    try {
      // POSIX kernels are started in their own process group so module-created
      // descendants are terminated with the execution boundary as well.
      process.kill(-child.pid, "SIGKILL")
    } catch {
      try {
        child.kill("SIGKILL")
      } catch {
        // The final exit check below determines whether isolation succeeded.
      }
    }
  }
  if (await waitForExit(child, KERNEL_EXIT_TIMEOUT_MS)) return true
  try {
    child.kill("SIGKILL")
  } catch {
    // The final exit check below determines whether isolation succeeded.
  }
  return waitForExit(child, KERNEL_EXIT_TIMEOUT_MS)
}

async function spawnKernel() {
  if (shuttingDown) throw new Error("Node REPL supervisor is shutting down.")
  const generation = ++kernelGeneration
  const child = fork(KERNEL_PATH, [], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ANYBOX_NODE_REPL_MODULE_DIRS_JSON: JSON.stringify(nodeModuleDirs),
    },
    detached: process.platform !== "win32",
    serialization: "json",
    stdio: ["ignore", "ignore", "pipe", "ipc"],
    windowsHide: true,
  })
  child.stderr?.pipe(process.stderr, { end: false })
  const runtime = { child, generation }
  spawningKernel = runtime

  await new Promise((resolve, reject) => {
    let timer
    const cleanup = () => {
      clearTimeout(timer)
      child.removeListener("message", onMessage)
      child.removeListener("error", onError)
      child.removeListener("exit", onExit)
    }
    const onMessage = (message) => {
      if (!message || message.type !== "ready") return
      cleanup()
      resolve()
    }
    const onError = (error) => {
      cleanup()
      reject(error)
    }
    const onExit = (code, signal) => {
      cleanup()
      reject(new Error(`Node REPL kernel exited during startup (code=${code}, signal=${signal}).`))
    }
    child.on("message", onMessage)
    child.once("error", onError)
    child.once("exit", onExit)
    timer = setTimeout(() => {
      cleanup()
      reject(new Error(`Node REPL kernel did not start within ${KERNEL_START_TIMEOUT_MS}ms.`))
    }, KERNEL_START_TIMEOUT_MS)
  }).catch(async (error) => {
    await terminateKernel(runtime)
    throw error
  }).finally(() => {
    if (spawningKernel === runtime) spawningKernel = undefined
  })

  child.once("exit", () => {
    if (kernel === runtime) kernel = undefined
  })
  return runtime
}

async function ensureKernel() {
  if (kernel && kernel.child.exitCode === null && kernel.child.signalCode === null) return kernel
  if (startingKernel) return startingKernel
  const promise = spawnKernel().then((runtime) => {
    if (shuttingDown) {
      void terminateKernel(runtime)
      throw new Error("Node REPL supervisor is shutting down.")
    }
    kernel = runtime
    return runtime
  }).finally(() => {
    if (startingKernel === promise) startingKernel = undefined
  })
  startingKernel = promise
  return promise
}

async function replaceKernel(expected) {
  if (recoveryPromise) return recoveryPromise
  const promise = (async () => {
    if (kernel === expected) kernel = undefined
    const stopped = await terminateKernel(expected)
    if (!stopped) {
      process.stderr.write("[anybox-node-repl] failed to terminate the kernel; terminating the MCP supervisor isolation boundary.\n")
      setImmediate(() => process.exit(70))
      throw runtimeError("Node REPL kernel could not be isolated; the MCP server is terminating.", {
        code: "KERNEL_ISOLATION_FAILED",
        runtimeReset: false,
      })
    }
    if (!shuttingDown) await ensureKernel()
    return true
  })().finally(() => {
    if (recoveryPromise === promise) recoveryPromise = undefined
  })
  recoveryPromise = promise
  return promise
}

function sendKernel(child, message) {
  return new Promise((resolve, reject) => {
    if (!child.connected) {
      reject(new Error("Node REPL kernel IPC is disconnected."))
      return
    }
    child.send(message, (error) => error ? reject(error) : resolve())
  })
}

async function runKernelCommand(input) {
  const runtime = await ensureKernel()
  const commandID = `command:${runtime.generation}:${++kernelCommandSequence}`

  return new Promise((resolve, reject) => {
    let settled = false
    let recovering = false
    const bridgeClientRequestIDs = new Set()

    const cleanup = () => {
      budget.stop()
      runtime.child.removeListener("message", onMessage)
      runtime.child.removeListener("exit", onExit)
      if (activeKernelCommand?.commandID === commandID) activeKernelCommand = undefined
    }
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      cleanup()
      callback(value)
    }
    const recover = async (error) => {
      if (settled || recovering) return
      recovering = true
      budget.stop()
      for (const requestID of bridgeClientRequestIDs) cancelClientRequest(requestID, error)
      bridgeClientRequestIDs.clear()
      try {
        error.runtimeReset = await replaceKernel(runtime)
      } catch (recoveryError) {
        error = recoveryError
      }
      finish(reject, error)
    }
    const onTimeout = () => {
      const message = input.timeoutMessage ?? `Node REPL operation timed out after ${input.timeoutMs}ms.`
      void recover(runtimeError(message, {
        code: input.timeoutCode ?? "EXECUTION_TIMEOUT",
        retryable: true,
      }))
    }
    const budget = executionBudget(input.timeoutMs, onTimeout)
    const onExit = (code, signal) => {
      void recover(runtimeError(
        `Node REPL kernel exited before completing the request (code=${code}, signal=${signal}).`,
        { code: "KERNEL_EXIT", retryable: true },
      ))
    }
    const onMessage = (message) => {
      if (!message || typeof message !== "object") return
      if (message.type === "bridge-request" && message.commandID === commandID) {
        budget.pause()
        const outbound = requestClient(message.method, message.params, message.timeoutMs)
        bridgeClientRequestIDs.add(outbound.id)
        void outbound.promise.then(
          (result) => sendKernel(runtime.child, {
            type: "bridge-response",
            id: message.id,
            result,
          }),
          (error) => sendKernel(runtime.child, {
            type: "bridge-response",
            id: message.id,
            error: {
              message: error instanceof Error ? error.message : String(error),
              ...(error && typeof error === "object" && typeof error.code === "string"
                ? { code: error.code }
                : {}),
            },
          }),
        ).catch((error) => recover(runtimeError(
          `Failed to resume the Node REPL kernel: ${error instanceof Error ? error.message : String(error)}`,
          { code: "KERNEL_IPC_FAILURE", retryable: true },
        ))).finally(() => {
          bridgeClientRequestIDs.delete(outbound.id)
          budget.resume()
        })
        return
      }
      if (message.type !== "command-result" || message.id !== commandID) return
      if (message.error) {
        const error = runtimeError(
          typeof message.error.message === "string" ? message.error.message : "Node REPL kernel failed.",
          {
            code: message.error.code,
            retryable: message.error.retryable,
            details: message.error.details,
          },
        )
        finish(reject, error)
      } else {
        finish(resolve, message.result)
      }
    }

    activeKernelCommand = {
      commandID,
      requestID: input.requestID,
      abort(reason) {
        return recover(runtimeError(
          reason || "Execution cancelled. The Node REPL runtime was reset.",
          { code: "EXECUTION_CANCELLED", status: "cancelled", retryable: true },
        ))
      },
    }
    runtime.child.on("message", onMessage)
    runtime.child.once("exit", onExit)
    void sendKernel(runtime.child, {
      type: "command",
      id: commandID,
      command: input.command,
      name: input.name,
      args: input.args,
      context: input.context,
      lifecycle: input.lifecycle,
    }).catch((error) => recover(runtimeError(
      `Failed to send the Node REPL kernel request: ${error instanceof Error ? error.message : String(error)}`,
      { code: "KERNEL_IPC_FAILURE", retryable: true },
    )))
  })
}

async function callTool(name, args, context, requestID) {
  const normalizedName = {
    node_repl_js: "js",
    node_repl_reset: "js_reset",
    node_repl_add_node_module_dir: "js_add_node_module_dir",
  }[name] || name
  if (!["js", "js_reset", "js_add_node_module_dir"].includes(normalizedName)) {
    throw new Error(`Unknown tool: ${name}`)
  }
  if (normalizedName === "js") {
    const code = args && typeof args.code === "string" ? args.code : ""
    if (!code.trim()) throw new Error("js requires code.")
  }

  const executionMs = normalizedName === "js"
    ? timeoutMs(args && args.timeoutMs)
    : KERNEL_CONTROL_TIMEOUT_MS
  const result = await runKernelCommand({
    command: "call-tool",
    name: normalizedName,
    args,
    context,
    requestID,
    timeoutMs: executionMs,
    timeoutMessage: normalizedName === "js"
      ? `Execution timed out after ${executionMs}ms. The Node REPL runtime was reset.`
      : `Node REPL control operation timed out after ${executionMs}ms. The runtime was reset.`,
    timeoutCode: normalizedName === "js" ? "EXECUTION_TIMEOUT" : "CONTROL_TIMEOUT",
  })

  if (normalizedName === "js_add_node_module_dir") {
    const added = result?.structuredContent?.path
    if (typeof added === "string" && !nodeModuleDirs.includes(added)) nodeModuleDirs.push(added)
  }
  return result
}

function enqueue(work) {
  const task = serialTail.then(work)
  serialTail = task.catch(() => undefined)
  return task
}

function handleToolCall(message) {
  const key = requestKey(message.id)
  pendingToolRequestIDs.add(key)
  void enqueue(async () => {
    if (cancelledRequestIDs.delete(key)) {
      pendingToolRequestIDs.delete(key)
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: errorResult(runtimeError(
          "Execution cancelled before it started. The Node REPL runtime was not changed.",
          { code: "EXECUTION_CANCELLED", status: "cancelled", runtimeReset: false },
        )),
      })
      return
    }
    try {
      const result = await callTool(
        message.params && message.params.name,
        message.params && message.params.arguments,
        readRequestContext(message),
        message.id,
      )
      send({ jsonrpc: "2.0", id: message.id, result })
    } catch (error) {
      send({ jsonrpc: "2.0", id: message.id, result: errorResult(error) })
    } finally {
      cancelledRequestIDs.delete(key)
      pendingToolRequestIDs.delete(key)
    }
  }).catch((error) => {
    cancelledRequestIDs.delete(key)
    pendingToolRequestIDs.delete(key)
    send({ jsonrpc: "2.0", id: message.id, result: errorResult(error) })
  })
}

function handleLifecycle(message) {
  const params = message.params && typeof message.params === "object"
    ? message.params
    : {}
  void enqueue(() => runKernelCommand({
    command: "lifecycle",
    lifecycle: {
      type: typeof params.type === "string" ? params.type : "turn-end",
      context: params.context && typeof params.context === "object" ? params.context : undefined,
      detail: params.detail,
    },
    timeoutMs: KERNEL_CONTROL_TIMEOUT_MS,
    timeoutMessage: `Node REPL lifecycle hook timed out after ${KERNEL_CONTROL_TIMEOUT_MS}ms. The runtime was reset.`,
    timeoutCode: "LIFECYCLE_TIMEOUT",
  })).catch((error) => {
    process.stderr.write(`[anybox-node-repl] lifecycle notification failed: ${error instanceof Error ? error.message : String(error)}\n`)
  })
}

async function shutdown(code = 0) {
  if (shutdownPromise) return shutdownPromise
  shuttingDown = true
  shutdownPromise = (async () => {
    const error = new Error("MCP transport closed during an in-process request.")
    error.code = "CONNECTION_CLOSED"
    for (const pending of pendingClientRequests.values()) pending.reject(error)
    pendingClientRequests.clear()
    const runtimes = [...new Set([kernel, spawningKernel].filter(Boolean))]
    kernel = undefined
    spawningKernel = undefined
    const stopped = (await Promise.all(runtimes.map((runtime) => terminateKernel(runtime))))
      .every(Boolean)
    process.exit(stopped ? code : 70)
  })()
  return shutdownPromise
}

const rl = readline.createInterface({ input: process.stdin })

rl.on("line", (line) => {
  if (!line.trim() || shuttingDown) return
  let message
  try {
    message = JSON.parse(line)
  } catch (error) {
    send({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: error instanceof Error ? error.message : String(error) },
    })
    return
  }
  if (settleClientResponse(message)) return

  if (message.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "anybox-node-repl", version: "0.2.0" },
      },
    })
    return
  }

  if (message.method === "notifications/cancelled") {
    const requestID = message.params?.requestId
    if (requestID === undefined) return
    const key = requestKey(requestID)
    if (!pendingToolRequestIDs.has(key)) return
    cancelledRequestIDs.add(key)
    if (activeKernelCommand?.requestID === requestID) {
      void activeKernelCommand.abort(
        typeof message.params?.reason === "string" && message.params.reason
          ? `Execution cancelled: ${message.params.reason}. The Node REPL runtime was reset.`
          : "Execution cancelled. The Node REPL runtime was reset.",
      )
    }
    return
  }

  if (message.method === "notifications/anybox/lifecycle") {
    handleLifecycle(message)
    return
  }

  if (String(message.method || "").startsWith("notifications/")) return

  if (message.method === "tools/list") {
    send({ jsonrpc: "2.0", id: message.id, result: { tools } })
    return
  }

  if (message.method === "tools/call") {
    handleToolCall(message)
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
})

rl.on("close", () => {
  void shutdown(0)
})

for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  try {
    process.on(signal, () => {
      void shutdown(0)
    })
  } catch {
    // Some signals are not available on every platform.
  }
}
