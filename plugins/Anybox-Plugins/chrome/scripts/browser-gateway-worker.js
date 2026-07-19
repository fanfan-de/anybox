const { parentPort, workerData } = require("node:worker_threads")
const {
  BROWSER_IPC_PROTOCOL_VERSION,
  BrowserIpcRuntimeClient,
} = require("./browser-ipc-client.cjs")

const COMMAND_METHODS = new Set([
  "tabs.list",
  "tabs.open",
  "tabs.activate",
  "tabs.release",
  "page.snapshot",
  "page.interactiveSnapshot",
  "page.domTree",
  "page.accessibilityTree",
  "page.screenshot",
  "page.click",
  "page.clickElement",
  "page.fill",
  "page.type",
  "page.scroll",
  "page.waitFor",
])

if (!parentPort) throw new Error("Chrome browser gateway requires a worker parent port.")
if (Number(workerData?.protocolVersion) !== BROWSER_IPC_PROTOCOL_VERSION) {
  throw new Error("Chrome browser gateway IPC protocol version is incompatible.")
}

const client = new BrowserIpcRuntimeClient({
  endpoint: workerData?.runtimeEndpoint,
  brokerInstanceID: workerData?.brokerInstanceID,
  bootstrapProof: workerData?.runtimeProof,
  clientVersion: workerData?.clientVersion,
})

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizeContext(value) {
  if (!isRecord(value)) return undefined
  const context = {}
  for (const key of ["sessionID", "messageID", "toolCallID"]) {
    if (typeof value[key] === "string" && value[key].trim()) {
      context[key] = value[key].trim()
    }
  }
  return Object.keys(context).length > 0 ? context : undefined
}

function normalizeRequest(value) {
  if (!isRecord(value)) throw new Error("Browser gateway request is invalid.")
  if (value.type === "status") return { operation: "status" }
  if (value.type !== "command") {
    throw new Error("Browser gateway request type is invalid.")
  }
  if (typeof value.method !== "string" || !COMMAND_METHODS.has(value.method)) {
    throw new Error("Browser gateway command method is invalid.")
  }
  const timeoutMs = Number.isInteger(value.timeoutMs)
    && value.timeoutMs > 0
    && value.timeoutMs <= 120_000
    ? value.timeoutMs
    : undefined
  const context = normalizeContext(value.context)
  return {
    operation: "command",
    method: value.method,
    params: value.params,
    ...(timeoutMs ? { timeoutMs } : {}),
    ...(context ? { context } : {}),
  }
}

parentPort.on("message", (message) => {
  void (async () => {
    if (message?.type === "reset") {
      client.reset()
      parentPort.postMessage({ id: message.id, ok: true, data: { reset: true } })
      return
    }
    if (message?.type === "close") {
      client.reset()
      parentPort.postMessage({ id: message.id, ok: true, data: { closed: true } })
      return
    }

    const id = message?.id
    if (!Number.isSafeInteger(id) || id < 1) return
    try {
      parentPort.postMessage({
        id,
        ok: true,
        data: await client.request(normalizeRequest(message.request)),
      })
    } catch (error) {
      parentPort.postMessage({
        id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        code: error && typeof error === "object" ? error.code : undefined,
      })
    }
  })()
})

parentPort.on("close", () => client.reset())
parentPort.postMessage({ type: "ready" })
