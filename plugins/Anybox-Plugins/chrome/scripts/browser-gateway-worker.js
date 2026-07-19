const { parentPort, workerData } = require("node:worker_threads")
const {
  BROWSER_IPC_PROTOCOL_VERSION,
  BrowserIpcRuntimeClient,
} = require("./browser-ipc-client.cjs")

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
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error("Browser gateway command context is invalid.")
  const allowedKeys = new Set(["sessionID", "messageID", "toolCallID"])
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new Error("Browser gateway command context is invalid.")
  }
  const context = {}
  for (const key of allowedKeys) {
    if (value[key] === undefined) continue
    if (
      typeof value[key] !== "string"
      || !value[key].trim()
      || value[key].trim().length > 256
    ) {
      throw new Error("Browser gateway command context is invalid.")
    }
    context[key] = value[key].trim()
  }
  return Object.keys(context).length > 0 ? context : undefined
}

function normalizeRequest(value) {
  if (!isRecord(value)) throw new Error("Browser gateway request is invalid.")
  if (value.type === "status") return { operation: "status" }
  if (value.type === "getInfo") {
    if (!Number.isSafeInteger(value.contractVersion) || value.contractVersion < 1) {
      throw new Error("Browser gateway contract version is invalid.")
    }
    return {
      operation: "getInfo",
      contractVersion: value.contractVersion,
    }
  }
  if (value.type !== "command") {
    throw new Error("Browser gateway request type is invalid.")
  }
  if (
    typeof value.method !== "string"
    || !value.method.trim()
    || value.method.trim().length > 128
  ) {
    throw new Error("Browser gateway command method is invalid.")
  }
  const method = value.method.trim()
  let contractVersion
  if (value.contractVersion !== undefined) {
    if (!Number.isSafeInteger(value.contractVersion) || value.contractVersion < 1) {
      throw new Error("Browser gateway contract version is invalid.")
    }
    contractVersion = value.contractVersion
  }
  let timeoutMs
  if (value.timeoutMs !== undefined) {
    if (
      !Number.isSafeInteger(value.timeoutMs)
      || value.timeoutMs < 1
      || value.timeoutMs > 120_000
    ) {
      throw new Error("Browser gateway command timeout is invalid.")
    }
    timeoutMs = value.timeoutMs
  }
  const context = normalizeContext(value.context)
  return {
    operation: "command",
    method,
    params: value.params,
    ...(contractVersion ? { contractVersion } : {}),
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
        retryable: error && typeof error === "object" ? error.retryable : undefined,
        details: error && typeof error === "object" ? error.details : undefined,
      })
    }
  })()
})

parentPort.on("close", () => client.reset())
parentPort.postMessage({ type: "ready" })
