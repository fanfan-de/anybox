import { randomBytes } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { app } from "electron"
import WebSocket, { type Data } from "ws"
import { readTrimmedDesktopEnv } from "./env-compat"
import { safeError, safeLog, safeWarn } from "./safe-console"

const RELAY_DISABLED_ENV = "ANYBOX_MOBILE_RELAY_DISABLED"
const RELAY_URL_ENV = "ANYBOX_MOBILE_RELAY_URL"
const RELAY_IDENTITY_FILE_NAME = "mobile-relay-device.json"
const RELAY_RECONNECT_MIN_MS = 2_000
const RELAY_RECONNECT_MAX_MS = 30_000
const RELAY_REQUEST_TIMEOUT_MS = 15_000
const RELAY_MOBILE_HTTP_TIMEOUT_MS = 60_000
const RELAY_STREAM_CHUNK_BYTES = 48 * 1024

export interface DesktopCloudRelayStatus {
  enabled: boolean
  state: "disabled" | "idle" | "registering" | "connecting" | "connected" | "error"
  baseUrl: string | null
  desktopID: string | null
  pairingCode: string | null
  pairingExpiresAt: number | null
  pairingDeepLink: string | null
  connectedAt: number | null
  account: DesktopCloudRelayAccountStatus
  lastError?: string
}

export interface DesktopCloudRelayAccountStatus {
  state: "unknown" | "not_connected" | "connected" | "error"
  email?: string
  workspaceName?: string
  planLabel?: string
  entitlements?: {
    modelGatewayEnabled?: boolean
    relayEnabled?: boolean
    maxDesktopDevices?: number
    maxMobileDevices?: number
  }
  expiresAt?: number
  lastError?: string
}

export interface DesktopCloudRelayAccountSession {
  accessToken: string
  baseUrl?: string
  email?: string
  workspaceName?: string
  planLabel?: string
  entitlements?: {
    modelGatewayEnabled?: boolean
    relayEnabled?: boolean
    maxDesktopDevices?: number
    maxMobileDevices?: number
  }
  expiresAt?: number
}

export interface DesktopCloudRelayClientOptions {
  baseUrl: string | null
  desktopName: string
  appVersion?: string
  capabilities: string[]
  getBridgeToken: () => string | null
  getLocalBridgeBaseUrl: () => string | null
  getAccountSession?: () => Promise<DesktopCloudRelayAccountSession | null>
}

interface RelayIdentityDocument {
  version: 1
  desktopID: string
  token: string
}

interface RelayRegisterResult {
  desktopID: string
  pairingCode: string
  pairingExpiresAt: number
}

interface RelayCommandEnvelope {
  id: string
  type: string
  payload?: unknown
}

interface RelayMobileHttpResult {
  status: number
  headers: Record<string, string>
  body: unknown
  text: string
}

type RelayResponse<T> =
  | {
      success: true
      data: T
    }
  | {
      success: false
      error?: {
        code?: string
        message?: string
      }
    }

let options: DesktopCloudRelayClientOptions | null = null
let status: DesktopCloudRelayStatus = disabledStatus(null)
let identityPromise: Promise<RelayIdentityDocument> | null = null
let socket: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectDelayMs = RELAY_RECONNECT_MIN_MS
let stopped = true
let connectInFlight = false
const activeMobileStreams = new Map<string, AbortController>()

export function ensureDesktopCloudRelayClientRunning(nextOptions: DesktopCloudRelayClientOptions) {
  options = normalizeOptions(nextOptions)
  stopped = false

  if (!options.baseUrl) {
    status = disabledStatus(null)
    return status
  }

  if (isDisabled()) {
    status = disabledStatus(options.baseUrl)
    return status
  }

  scheduleReconnect(0)
  return status
}

export function getDesktopCloudRelayStatus() {
  return status
}

export async function refreshDesktopCloudRelayPairing() {
  const currentOptions = options
  if (!currentOptions?.baseUrl || isDisabled()) return status

  try {
    const identity = await readRelayIdentity()
    const account = await readRelayAccountSession(currentOptions)
    status = {
      ...status,
      account: account.status,
    }
    const registration = await registerDesktop(currentOptions, identity, true, account.session)
    updatePairingStatus(currentOptions.baseUrl, identity.desktopID, registration)
    reconnectDelayMs = RELAY_RECONNECT_MIN_MS
    scheduleReconnect(0)
  } catch (error) {
    setErrorStatus(currentOptions.baseUrl, error)
  }

  return status
}

export function stopDesktopCloudRelayClient() {
  stopped = true
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  abortActiveMobileStreams()
  socket?.close(1000, "desktop app stopped")
  socket = null
  status = disabledStatus(options?.baseUrl ?? null)
}

function normalizeOptions(input: DesktopCloudRelayClientOptions): DesktopCloudRelayClientOptions {
  const explicitUrl = readTrimmedDesktopEnv(RELAY_URL_ENV)
  const baseUrl = normalizeRelayBaseUrl(explicitUrl || input.baseUrl)
  return {
    ...input,
    baseUrl,
  }
}

function isDisabled() {
  if (process.env.NODE_ENV === "test" && !readTrimmedDesktopEnv(RELAY_URL_ENV)) return true
  const value = readTrimmedDesktopEnv(RELAY_DISABLED_ENV)
  return Boolean(value && /^(1|true|yes|on)$/i.test(value))
}

function disabledStatus(baseUrl: string | null): DesktopCloudRelayStatus {
  return {
    enabled: false,
    state: "disabled",
    baseUrl,
    desktopID: null,
    pairingCode: null,
    pairingExpiresAt: null,
    pairingDeepLink: null,
    connectedAt: null,
    account: {
      state: "unknown",
    },
  }
}

function scheduleReconnect(delayMs: number) {
  if (stopped || reconnectTimer || connectInFlight) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    void connectOnce()
  }, delayMs)
}

async function connectOnce() {
  const currentOptions = options
  if (!currentOptions?.baseUrl || stopped || connectInFlight) return

  connectInFlight = true
  try {
    const identity = await readRelayIdentity()
    status = {
      ...status,
      enabled: true,
      state: "registering",
      baseUrl: currentOptions.baseUrl,
      desktopID: identity.desktopID,
      lastError: undefined,
    }

    const account = await readRelayAccountSession(currentOptions)
    status = {
      ...status,
      account: account.status,
    }

    const registration = await registerDesktop(currentOptions, identity, false, account.session)
    updatePairingStatus(currentOptions.baseUrl, identity.desktopID, registration)
    status = {
      ...status,
      state: "connecting",
    }

    openRelaySocket(currentOptions, identity)
  } catch (error) {
    setErrorStatus(currentOptions.baseUrl, error)
    scheduleReconnect(nextReconnectDelay())
  } finally {
    connectInFlight = false
  }
}

function openRelaySocket(currentOptions: DesktopCloudRelayClientOptions, identity: RelayIdentityDocument) {
  const baseUrl = currentOptions.baseUrl
  if (!baseUrl) return

  const connection = createRelaySocketConnection(baseUrl, identity)
  const nextSocket = new WebSocket(connection.url, {
    headers: connection.headers,
  })
  abortActiveMobileStreams()
  socket?.close(4000, "replaced by newer relay socket")
  socket = nextSocket

  nextSocket.addEventListener("open", () => {
    if (socket !== nextSocket) return
    reconnectDelayMs = RELAY_RECONNECT_MIN_MS
    status = {
      ...status,
      enabled: true,
      state: "connected",
      connectedAt: Date.now(),
      lastError: undefined,
    }
    safeLog("[desktop][mobile-relay] connected")
  })

  nextSocket.addEventListener("message", (event) => {
    if (socket !== nextSocket) return
    void handleRelayMessage(nextSocket, event.data).catch((error) => {
      safeError("[desktop][mobile-relay] command failed", error)
    })
  })

  nextSocket.addEventListener("error", () => {
    if (socket !== nextSocket) return
    abortActiveMobileStreams()
    status = {
      ...status,
      state: "error",
      lastError: "Relay WebSocket failed.",
    }
  })

  nextSocket.addEventListener("close", () => {
    if (socket !== nextSocket) return
    abortActiveMobileStreams()
    socket = null
    status = {
      ...status,
      state: stopped ? "disabled" : "error",
      connectedAt: null,
      lastError: stopped ? undefined : "Relay WebSocket disconnected.",
    }
    if (!stopped) scheduleReconnect(nextReconnectDelay())
  })
}

function createRelaySocketConnection(baseUrl: string, identity: RelayIdentityDocument) {
  const url = new URL("/api/relay/desktop/connect", baseUrl)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  url.searchParams.set("desktopID", identity.desktopID)
  return {
    url: url.toString(),
    headers: {
      authorization: `Bearer ${identity.token}`,
    },
  }
}

async function handleRelayMessage(currentSocket: WebSocket, data: Data) {
  const raw = await readMessageData(data)
  const command = parseRelayCommand(raw)
  if (!command?.id || command.type === "relay.ready") return

  try {
    if (command.type === "mobile.stream") {
      await relayMobileStream(currentSocket, command)
      return
    }

    if (command.type === "mobile.stream.cancel") {
      sendRelayResult(currentSocket, command, true, cancelRelayMobileStream(command.payload))
      return
    }

    const payload = command.type === "workspace.list"
      ? readSuccessfulMobileHttpBody(await relayMobileHttp({ method: "GET", path: "/api/mobile/workspaces" }))
      : command.type === "mobile.http"
        ? await relayMobileHttp(command.payload)
        : await unsupportedCommand(command.type)
    sendRelayResult(currentSocket, command, true, payload)
  } catch (error) {
    sendRelayResult(currentSocket, command, false, undefined, {
      code: error instanceof RelayCommandError ? error.code : "desktop_command_failed",
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

async function relayMobileHttp(payload: unknown): Promise<RelayMobileHttpResult> {
  const request = parseMobileHttpPayload(payload)
  const currentOptions = options
  const bridgeBaseUrl = currentOptions?.getLocalBridgeBaseUrl()
  const bridgeToken = currentOptions?.getBridgeToken()
  if (!bridgeBaseUrl || !bridgeToken) {
    throw new RelayCommandError("bridge_unavailable", "Local mobile bridge is not available.")
  }
  if (request.path.includes("/stream")) {
    throw new RelayCommandError("stream_unsupported", "Streaming routes are not available through the cloud relay yet.")
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), RELAY_MOBILE_HTTP_TIMEOUT_MS)
  try {
    const response = await fetch(new URL(request.path, bridgeBaseUrl).toString(), {
      method: request.method,
      headers: {
        accept: "application/json, text/plain",
        authorization: `Bearer ${bridgeToken}`,
        "content-type": "application/json",
        ...request.headers,
      },
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      signal: controller.signal,
    })
    const text = await response.text()
    const headers: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() === "set-cookie") return
      headers[key] = value
    })
    return {
      status: response.status,
      headers,
      body: parseJson(text),
      text,
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function relayMobileStream(currentSocket: WebSocket, command: RelayCommandEnvelope) {
  const request = parseMobileStreamPayload(command.payload)
  const currentOptions = options
  const bridgeBaseUrl = currentOptions?.getLocalBridgeBaseUrl()
  const bridgeToken = currentOptions?.getBridgeToken()
  if (!bridgeBaseUrl || !bridgeToken) {
    throw new RelayCommandError("bridge_unavailable", "Local mobile bridge is not available.")
  }

  const controller = new AbortController()
  activeMobileStreams.set(command.id, controller)
  let opened = false

  try {
    const response = await fetch(new URL(request.path, bridgeBaseUrl).toString(), {
      method: request.method,
      headers: {
        accept: "text/event-stream, application/json, text/plain",
        authorization: `Bearer ${bridgeToken}`,
        "content-type": "application/json",
        ...request.headers,
      },
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      signal: controller.signal,
    })

    if (!response.ok) {
      throw readRelayStreamResponseError(response.status, await response.text().catch(() => ""))
    }

    sendRelayStreamOpen(currentSocket, command, response)
    opened = true

    if (!response.body) {
      const text = await response.text().catch(() => "")
      if (text) sendRelayStreamChunk(currentSocket, command, new TextEncoder().encode(text))
      sendRelayStreamEnd(currentSocket, command, true)
      return
    }

    const reader = response.body.getReader()
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        if (chunk.value) sendRelayStreamChunk(currentSocket, command, chunk.value)
      }
    } finally {
      reader.releaseLock()
    }

    sendRelayStreamEnd(currentSocket, command, true)
  } catch (error) {
    const relayError = error instanceof RelayCommandError
      ? error
      : new RelayCommandError("desktop_stream_failed", error instanceof Error ? error.message : String(error))
    if (opened) {
      sendRelayStreamEnd(currentSocket, command, false, relayError)
    } else {
      sendRelayResult(currentSocket, command, false, undefined, {
        code: relayError.code,
        message: relayError.message,
      })
    }
  } finally {
    activeMobileStreams.delete(command.id)
  }
}

function parseMobileHttpPayload(payload: unknown) {
  const record = readRecord(payload)
  const method = typeof record?.method === "string" ? record.method.trim().toUpperCase() : "GET"
  const requestPath = typeof record?.path === "string" ? record.path.trim() : ""
  if (!isAllowedMobileHttpMethod(method, requestPath)) {
    throw new RelayCommandError("method_unsupported", "Relay only supports GET, POST, and session model PATCH mobile bridge requests.")
  }
  if (!requestPath.startsWith("/api/mobile/") || requestPath.includes("://")) {
    throw new RelayCommandError("path_forbidden", "Relay mobile bridge path is invalid.")
  }

  const headers = readRecord(record?.headers)
  const safeHeaders: Record<string, string> = {}
  if (typeof headers?.["content-type"] === "string") {
    safeHeaders["content-type"] = headers["content-type"]
  }

  return {
    method,
    path: requestPath,
    body: typeof record?.body === "string" ? record.body : undefined,
    headers: safeHeaders,
  }
}

function isAllowedMobileHttpMethod(method: string, requestPath: string) {
  if (method === "GET" || method === "POST") return true
  if (method !== "PATCH") return false

  try {
    const parsed = new URL(requestPath, "http://relay.local")
    return parsed.origin === "http://relay.local" && /^\/api\/mobile\/sessions\/[^/]+\/model-selection$/.test(parsed.pathname)
  } catch {
    return false
  }
}

function parseMobileStreamPayload(payload: unknown) {
  const request = parseMobileHttpPayload(payload)
  let parsed: URL
  try {
    parsed = new URL(request.path, "http://relay.local")
  } catch {
    throw new RelayCommandError("path_forbidden", "Relay mobile stream path is invalid.")
  }
  if (parsed.origin !== "http://relay.local" || !parsed.pathname.startsWith("/api/mobile/") || !parsed.pathname.endsWith("/stream")) {
    throw new RelayCommandError("path_forbidden", "Relay mobile stream path is invalid.")
  }
  return request
}

function cancelRelayMobileStream(payload: unknown) {
  const record = readRecord(payload)
  const streamID = typeof record?.streamID === "string" ? record.streamID : ""
  const controller = streamID ? activeMobileStreams.get(streamID) : undefined
  if (controller) {
    controller.abort()
    activeMobileStreams.delete(streamID)
  }
  return {
    streamID,
    cancelled: Boolean(controller),
  }
}

function abortActiveMobileStreams() {
  for (const controller of activeMobileStreams.values()) {
    controller.abort()
  }
  activeMobileStreams.clear()
}

async function unsupportedCommand(type: string): Promise<never> {
  throw new RelayCommandError("command_unsupported", `Relay command '${type}' is not supported by this desktop build.`)
}

function readSuccessfulMobileHttpBody(result: RelayMobileHttpResult) {
  if (result.status < 200 || result.status >= 300) {
    const record = readRecord(result.body)
    const error = readRecord(record?.error)
    throw new RelayCommandError(
      typeof error?.code === "string" ? error.code : "mobile_http_failed",
      typeof error?.message === "string" ? error.message : `Local mobile bridge request failed with HTTP ${result.status}.`,
    )
  }
  const record = readRecord(result.body)
  return record?.success === true && "data" in record ? record.data : result.body
}

function sendRelayResult(
  currentSocket: WebSocket,
  command: RelayCommandEnvelope,
  ok: boolean,
  payload?: unknown,
  error?: { code?: string; message?: string },
) {
  if (currentSocket.readyState !== WebSocket.OPEN) return
  currentSocket.send(JSON.stringify({
    id: createRelayEventID(),
    replyTo: command.id,
    type: `${command.type}.result`,
    ok,
    ...(payload !== undefined ? { payload } : {}),
    ...(error ? { error } : {}),
  }))
}

function sendRelayStreamOpen(currentSocket: WebSocket, command: RelayCommandEnvelope, response: Response) {
  if (currentSocket.readyState !== WebSocket.OPEN) return
  const headers: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    const normalizedKey = key.toLowerCase()
    if (normalizedKey === "set-cookie" || normalizedKey === "content-length" || normalizedKey === "transfer-encoding") return
    headers[key] = value
  })
  currentSocket.send(JSON.stringify({
    id: createRelayEventID(),
    replyTo: command.id,
    type: "mobile.stream.open",
    ok: true,
    payload: {
      status: response.status,
      headers,
    },
  }))
}

function sendRelayStreamChunk(currentSocket: WebSocket, command: RelayCommandEnvelope, value: Uint8Array) {
  if (currentSocket.readyState !== WebSocket.OPEN) return
  for (let offset = 0; offset < value.byteLength; offset += RELAY_STREAM_CHUNK_BYTES) {
    const chunk = value.subarray(offset, offset + RELAY_STREAM_CHUNK_BYTES)
    currentSocket.send(JSON.stringify({
      id: createRelayEventID(),
      replyTo: command.id,
      type: "mobile.stream.chunk",
      ok: true,
      payload: {
        chunk: Buffer.from(chunk).toString("base64"),
      },
    }))
  }
}

function sendRelayStreamEnd(currentSocket: WebSocket, command: RelayCommandEnvelope, ok: boolean, error?: RelayCommandError) {
  if (currentSocket.readyState !== WebSocket.OPEN) return
  currentSocket.send(JSON.stringify({
    id: createRelayEventID(),
    replyTo: command.id,
    type: "mobile.stream.end",
    ok,
    ...(error ? {
      error: {
        code: error.code,
        message: error.message,
      },
    } : {}),
  }))
}

function readRelayStreamResponseError(status: number, text: string) {
  const body = parseJson(text)
  const record = readRecord(body)
  const error = readRecord(record?.error)
  return new RelayCommandError(
    typeof error?.code === "string" ? error.code : "mobile_stream_failed",
    typeof error?.message === "string" ? error.message : `Local mobile bridge stream failed with HTTP ${status}.`,
  )
}

async function registerDesktop(
  currentOptions: DesktopCloudRelayClientOptions,
  identity: RelayIdentityDocument,
  refreshPairing: boolean,
  accountSession?: DesktopCloudRelayAccountSession | null,
) {
  return relayRequest<RelayRegisterResult>(currentOptions.baseUrl ?? "", "/api/relay/desktop/register", {
    method: "POST",
    ...(accountSession?.accessToken
      ? {
          headers: {
            authorization: `Bearer ${accountSession.accessToken}`,
          },
        }
      : {}),
    body: JSON.stringify({
      desktopID: identity.desktopID,
      token: identity.token,
      name: currentOptions.desktopName,
      appVersion: currentOptions.appVersion,
      capabilities: currentOptions.capabilities,
      refreshPairing,
    }),
  })
}

async function readRelayAccountSession(currentOptions: DesktopCloudRelayClientOptions): Promise<{
  session: DesktopCloudRelayAccountSession | null
  status: DesktopCloudRelayAccountStatus
}> {
  if (!currentOptions.getAccountSession) {
    return { session: null, status: { state: "unknown" } }
  }

  try {
    const session = await currentOptions.getAccountSession()
    if (!session?.accessToken) {
      return { session: null, status: { state: "not_connected" } }
    }
    if (session.baseUrl && currentOptions.baseUrl && normalizeRelayBaseUrl(session.baseUrl) !== currentOptions.baseUrl) {
      return {
        session: null,
        status: {
          state: "error",
          email: session.email,
          workspaceName: session.workspaceName,
          planLabel: session.planLabel,
          entitlements: session.entitlements,
          expiresAt: session.expiresAt,
          lastError: "Anybox Provider account URL does not match the mobile relay URL.",
        },
      }
    }
    return {
      session,
      status: {
        state: "connected",
        email: session.email,
        workspaceName: session.workspaceName,
        planLabel: session.planLabel,
        entitlements: session.entitlements,
        expiresAt: session.expiresAt,
      },
    }
  } catch (error) {
    return {
      session: null,
      status: {
        state: "error",
        lastError: error instanceof Error ? error.message : String(error),
      },
    }
  }
}

async function relayRequest<T>(baseUrl: string, pathName: string, init: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), RELAY_REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(new URL(pathName, baseUrl).toString(), {
      ...init,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...init.headers,
      },
      signal: controller.signal,
    })
    const body = await response.json().catch(() => null) as RelayResponse<T> | null
    if (!response.ok || !body || body.success !== true) {
      const code = body?.success === false ? body.error?.code : undefined
      const message = describeRelayRequestError(code, body?.success === false ? body.error?.message : undefined, response.status)
      throw new RelayRequestError(response.status, code ?? "relay_request_failed", message)
    }
    return body.data
  } finally {
    clearTimeout(timeout)
  }
}

function updatePairingStatus(baseUrl: string, desktopID: string, registration: RelayRegisterResult) {
  status = {
    ...status,
    enabled: true,
    baseUrl,
    desktopID,
    pairingCode: registration.pairingCode,
    pairingExpiresAt: registration.pairingExpiresAt,
    pairingDeepLink: createRelayPairingDeepLink(baseUrl, registration.pairingCode),
    lastError: undefined,
  }
}

function setErrorStatus(baseUrl: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  status = {
    ...status,
    enabled: true,
    state: "error",
    baseUrl,
    connectedAt: null,
    lastError: message,
  }
  safeWarn("[desktop][mobile-relay] connection failed", message)
}

function nextReconnectDelay() {
  const current = reconnectDelayMs
  reconnectDelayMs = Math.min(RELAY_RECONNECT_MAX_MS, reconnectDelayMs * 2)
  return current
}

async function readRelayIdentity() {
  if (!identityPromise) {
    identityPromise = loadRelayIdentity()
  }
  return identityPromise
}

async function loadRelayIdentity(): Promise<RelayIdentityDocument> {
  const filePath = getRelayIdentityPath()
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as Partial<RelayIdentityDocument>
    if (parsed.version === 1 && isRelayID(parsed.desktopID) && isRelayID(parsed.token)) {
      return {
        version: 1,
        desktopID: parsed.desktopID,
        token: parsed.token,
      }
    }
  } catch {
    // Fall through and create a fresh identity.
  }

  const document: RelayIdentityDocument = {
    version: 1,
    desktopID: createRelaySecret("desktop"),
    token: createRelaySecret("relay_desktop"),
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(document, null, 2)}\n`, "utf8")
  return document
}

function getRelayIdentityPath() {
  return path.join(app.getPath("userData"), RELAY_IDENTITY_FILE_NAME)
}

function createRelaySecret(prefix: string) {
  return `${prefix}_${randomBytes(24).toString("base64url")}`
}

function createRelayEventID() {
  return createRelaySecret("evt")
}

function isRelayID(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{12,256}$/.test(value)
}

function createRelayPairingDeepLink(baseUrl: string, code: string) {
  const params = new URLSearchParams({ code, url: baseUrl })
  return `anybox-mobile://pair?${params.toString()}`
}

function normalizeRelayBaseUrl(value: string | null | undefined) {
  if (!value?.trim()) return null
  try {
    const url = new URL(value.trim())
    if (url.protocol !== "https:" && url.protocol !== "http:") return null
    return url.origin
  } catch {
    return null
  }
}

async function readMessageData(data: Data) {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8")
  if (typeof data === "string") return data
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data)
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data)
  return String(data)
}

function parseRelayCommand(raw: string): RelayCommandEnvelope | null {
  try {
    const parsed = JSON.parse(raw) as Partial<RelayCommandEnvelope>
    return parsed && typeof parsed === "object" && typeof parsed.id === "string" && typeof parsed.type === "string"
      ? {
          id: parsed.id,
          type: parsed.type,
          payload: parsed.payload,
        }
      : null
  } catch {
    return null
  }
}

function parseJson(text: string) {
  if (!text.trim()) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

function readRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

class RelayCommandError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "RelayCommandError"
  }
}

class RelayRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "RelayRequestError"
  }
}

function describeRelayRequestError(code: string | undefined, message: string | undefined, status: number) {
  if (code === "relay_disabled") {
    return "当前套餐不支持 Relay。请在管理后台启用 Relay 权益后重试。"
  }
  if (code === "device_limit_exceeded") {
    return "桌面设备数量已达上限。请移除旧设备，或在管理后台提高设备上限后重试。"
  }
  return message || `Relay request failed with HTTP ${status}.`
}

export const internal = {
  createRelaySocketConnection,
  describeRelayRequestError,
  parseMobileHttpPayload,
}
