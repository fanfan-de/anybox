const { parentPort, workerData } = require("node:worker_threads")

const TRUSTED_TOKEN_HEADER = "x-anybox-browser-trusted-token"
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
const isolatedFetch = globalThis.fetch?.bind(globalThis)
const agentBaseURL = normalizeBaseURL(workerData?.agentBaseURL)
const trustedToken = typeof workerData?.trustedToken === "string"
  ? workerData.trustedToken
  : ""

if (!parentPort) throw new Error("Chrome browser gateway requires a worker parent port.")

function isLoopbackHostname(hostname) {
  const normalized = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname
  if (normalized.toLowerCase() === "localhost" || normalized === "::1") return true

  const octets = normalized.split(".")
  return octets.length === 4
    && octets[0] === "127"
    && octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
}

function normalizeBaseURL(value) {
  const parsed = new URL(String(value || "").trim())
  if (parsed.protocol !== "http:") {
    throw new Error("Chrome browser gateway requires a local HTTP Anybox Agent URL.")
  }
  if (!isLoopbackHostname(parsed.hostname)) {
    throw new Error("Chrome browser gateway requires a loopback Anybox Agent host.")
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(
      "Chrome browser gateway Anybox Agent URL cannot contain credentials, query, or fragment.",
    )
  }
  return parsed.toString().replace(/\/+$/, "")
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readApiErrorMessage(body) {
  if (!isRecord(body) || !isRecord(body.error)) return undefined
  return typeof body.error.message === "string" ? body.error.message : undefined
}

function normalizeRequest(value) {
  if (!isRecord(value)) throw new Error("Browser gateway request is invalid.")
  if (value.type === "status") {
    return {
      path: "/api/browser-extension/status",
      init: { method: "GET" },
    }
  }
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
  return {
    path: "/api/browser-extension/command",
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        method: value.method,
        params: value.params,
        ...(timeoutMs ? { timeoutMs } : {}),
      }),
    },
  }
}

async function requestAgent(request) {
  if (!trustedToken) throw new Error("Chrome browser gateway token is not available.")
  if (typeof isolatedFetch !== "function") {
    throw new Error("Chrome browser gateway requires a Node.js runtime with fetch support.")
  }

  const normalized = normalizeRequest(request)
  const response = await isolatedFetch(`${agentBaseURL}${normalized.path}`, {
    ...normalized.init,
    headers: {
      accept: "application/json",
      ...(normalized.init.headers ?? {}),
      [TRUSTED_TOKEN_HEADER]: trustedToken,
    },
  })
  const bodyText = await response.text()
  let body
  try {
    body = bodyText ? JSON.parse(bodyText) : undefined
  } catch {
    body = undefined
  }

  if (!response.ok) {
    throw new Error(
      readApiErrorMessage(body)
      || bodyText.trim()
      || `Anybox agent request failed with HTTP ${response.status}.`,
    )
  }
  if (!isRecord(body) || body.success !== true) {
    throw new Error("Anybox agent returned an invalid API envelope.")
  }
  return body.data
}

parentPort.on("message", (message) => {
  void (async () => {
    const id = message?.id
    if (!Number.isSafeInteger(id) || id < 1) return
    try {
      parentPort.postMessage({ id, ok: true, data: await requestAgent(message.request) })
    } catch (error) {
      parentPort.postMessage({
        id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })()
})

parentPort.postMessage({ type: "ready" })
