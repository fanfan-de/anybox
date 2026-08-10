import { ApiEnvelopeSchema, SessionEventSchema, type ApiEnvelope, type SessionEvent } from "@anybox/shared"
import { readTrimmedDesktopEnv } from "./env-compat"
import { resolveDefaultAgentWorkdir } from "./agent-workdir"
import type { AgentConfig } from "./types"
import { getAppRuntimeGatewaySecret } from "./app-runtime-gateway-secret"

const DEFAULT_AGENT_BASE_URL = "http://127.0.0.1:4096"

export class AgentAPIError extends Error {
  readonly status: number
  readonly code?: string
  readonly requestId?: string

  constructor(input: { message: string; status: number; code?: string; requestId?: string }) {
    super(input.message)
    this.name = "AgentAPIError"
    this.status = input.status
    this.code = input.code
    this.requestId = input.requestId
  }
}

export function getAgentConfig(): AgentConfig {
  return {
    baseURL: readTrimmedDesktopEnv("ANYBOX_AGENT_BASE_URL") || DEFAULT_AGENT_BASE_URL,
    defaultDirectory: resolveDefaultAgentWorkdir(),
  }
}

export function resolveAgentURL(pathname: string) {
  const baseURL = readTrimmedDesktopEnv("ANYBOX_AGENT_BASE_URL") || DEFAULT_AGENT_BASE_URL
  const normalizedBase = baseURL.endsWith("/") ? baseURL : `${baseURL}/`
  return new URL(pathname, normalizedBase).toString()
}

export async function requestAgentAppRuntime(
  pluginID: string,
  pathname: string,
  request: Request,
) {
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`
  const targetPath = `/api/plugins/installed/${encodeURIComponent(pluginID)}/app-runtime${normalizedPath}`
  const headers = new Headers(request.headers)
  headers.delete("host")
  headers.delete("origin")
  headers.delete("referer")
  headers.delete("content-length")
  headers.set("x-anybox-app-gateway-secret", getAppRuntimeGatewaySecret())
  const method = request.method.toUpperCase()
  const init: RequestInit & { duplex?: "half" } = {
    method,
    headers,
    redirect: "manual",
    signal: request.signal,
  }
  if (method !== "GET" && method !== "HEAD" && request.body) {
    init.body = request.body
    init.duplex = "half"
  }
  const response = await fetch(resolveAgentURL(targetPath), init)
  const responseHeaders = new Headers(response.headers)
  responseHeaders.delete("access-control-allow-origin")
  responseHeaders.delete("access-control-allow-credentials")
  responseHeaders.delete("set-cookie")
  responseHeaders.delete("set-cookie2")
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  })
}

export function resolveAgentWebSocketURL(
  pathname: string,
  searchParams?: Record<string, string | number | undefined>,
) {
  const url = new URL(resolveAgentURL(pathname))
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"

  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value === undefined || value === null || value === "") continue
      url.searchParams.set(key, String(value))
    }
  }

  return url.toString()
}

export async function requestAgentJSON<T>(pathname: string, init?: RequestInit) {
  const response = await fetch(resolveAgentURL(pathname), init)
  const rawEnvelope = await response.json().catch(() => null)
  const parsedEnvelope = ApiEnvelopeSchema.safeParse(rawEnvelope)
  const envelope = parsedEnvelope.success ? (parsedEnvelope.data as ApiEnvelope<T>) : null

  if (!response.ok || !envelope || envelope.success !== true || envelope.data === undefined) {
    const fallback = `Agent API request failed (${response.status})`
    const apiError = envelope?.success === false ? envelope.error : undefined
    throw new AgentAPIError({
      message: apiError?.message || fallback,
      status: response.status,
      code: apiError?.code,
      requestId: response.headers.get("x-request-id") ?? undefined,
    })
  }

  return {
    data: envelope.data,
    requestId: response.headers.get("x-request-id") ?? undefined,
  }
}

export function parseSSE(raw: string): SessionEvent[] {
  const events: SessionEvent[] = []

  for (const block of raw.split(/\r?\n\r?\n/)) {
    const parsed = parseSSEBlock(block)
    if (parsed) events.push(parsed)
  }

  return events
}

function parseSSEBlock(block: string): SessionEvent | null {
  if (!block.trim()) return null

  let eventID = ""
  let eventName = ""
  const dataLines: string[] = []

  for (const rawLine of block.split(/\r?\n/)) {
    if (!rawLine || rawLine.startsWith(":")) continue

    const separatorIndex = rawLine.indexOf(":")
    const field = separatorIndex === -1 ? rawLine : rawLine.slice(0, separatorIndex)
    let value = separatorIndex === -1 ? "" : rawLine.slice(separatorIndex + 1)
    if (value.startsWith(" ")) {
      value = value.slice(1)
    }

    if (field === "id") {
      eventID = value.trim()
      continue
    }

    if (field === "event") {
      eventName = value.trim()
      continue
    }

    if (field === "data") {
      dataLines.push(value)
    }
  }

  const payload = dataLines.join("\n")

  if (!eventName || !payload) return null

  let data: unknown = payload
  try {
    data = JSON.parse(payload)
  } catch {
    data = payload
  }

  const event = {
    ...(eventID ? { id: eventID } : {}),
    event: eventName,
    data,
  }

  const parsed = SessionEventSchema.safeParse(event)
  return parsed.success ? parsed.data : null
}

export function consumeSSEBuffer(raw: string, flush = false) {
  const events: SessionEvent[] = []
  const boundaryPattern = /\r?\n\r?\n/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = boundaryPattern.exec(raw)) !== null) {
    const parsed = parseSSEBlock(raw.slice(lastIndex, match.index))
    if (parsed) events.push(parsed)
    lastIndex = match.index + match[0].length
  }

  const remainder = raw.slice(lastIndex)
  if (flush) {
    const parsed = parseSSEBlock(remainder)
    if (parsed) events.push(parsed)
    return {
      events,
      remainder: "",
    }
  }

  return {
    events,
    remainder,
  }
}

export async function readAgentSSEStream(
  response: Response,
  onEvent: (event: SessionEvent) => void,
): Promise<void> {
  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error("Agent stream body is unavailable")
  }

  const decoder = new TextDecoder()
  let buffer = ""
  let handledEventCount = 0

  async function yieldAfterEventBurst() {
    handledEventCount += 1
    if (handledEventCount % 50 !== 0) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  while (true) {
    const { value, done } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const parsed = consumeSSEBuffer(buffer)
    buffer = parsed.remainder

    for (const event of parsed.events) {
      onEvent(event)
      await yieldAfterEventBurst()
    }
  }

  buffer += decoder.decode()
  const trailing = consumeSSEBuffer(buffer, true)
  for (const event of trailing.events) {
    onEvent(event)
    await yieldAfterEventBurst()
  }
}
