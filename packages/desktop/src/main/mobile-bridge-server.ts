import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { spawn, type ChildProcess } from "node:child_process"
import { app, BrowserWindow } from "electron"
import fs from "node:fs/promises"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { URL } from "node:url"
import { requestAgentJSON, resolveAgentURL } from "./agent-client"
import { buildFolderWorkspaces } from "./folder-workspaces"
import {
  ensureDesktopCloudRelayClientRunning,
  getDesktopCloudRelayStatus,
  refreshDesktopCloudRelayPairing,
  stopDesktopCloudRelayClient,
  type DesktopCloudRelayStatus,
} from "./desktop-cloud-relay-client"
import { safeError, safeLog, safeWarn } from "./safe-console"
import { getWebContentsForWindowSafely, sendWebContentsSafely } from "./safe-web-contents-send"
import type { AgentFolderWorkspace, AgentProjectInfo, AgentProjectWorkspace, AgentSessionInfo, AgentWorkspaceSession } from "./types"
import { getWorkspaceGitDiff } from "./workspace-diff"
import {
  DESKTOP_MOBILE_BRIDGE_EVENT_CHANNEL,
  type MobileBridgeDesktopEvent,
} from "../shared/desktop-ipc-contract"

const DEFAULT_MOBILE_BRIDGE_HOST = "0.0.0.0"
const DEFAULT_MOBILE_BRIDGE_PORT = 4896
const DEFAULT_MOBILE_BRIDGE_PUBLIC_URL = "https://anybox.com.cn"
const MOBILE_BRIDGE_HOST_ENV = "ANYBOX_MOBILE_BRIDGE_HOST"
const MOBILE_BRIDGE_PORT_ENV = "ANYBOX_MOBILE_BRIDGE_PORT"
const MOBILE_BRIDGE_PUBLIC_URL_ENV = "ANYBOX_MOBILE_BRIDGE_PUBLIC_URL"
const MOBILE_BRIDGE_TUNNEL_ENV = "ANYBOX_MOBILE_BRIDGE_TUNNEL"
const MOBILE_BRIDGE_TUNNEL_TARGET_ENV = "ANYBOX_MOBILE_BRIDGE_TUNNEL_TARGET"
const DESKTOP_DEVICE_NAME_ENV = "ANYBOX_DESKTOP_DEVICE_NAME"
const TOKEN_QUERY_PARAM = "token"
const PAIRING_CODE_QUERY_PARAM = "code"
const MOBILE_DEVICES_FILE_NAME = "mobile-devices.json"
const MOBILE_HANDOFF_FILE_NAME = "mobile-bridge-handoff.json"
const DEVICE_LAST_SEEN_WRITE_INTERVAL_MS = 60_000
const MOBILE_PAIRING_CODE_TTL_MS = 5 * 60_000
const MOBILE_EVENTS_POLL_INTERVAL_MS = 5_000
const MOBILE_EVENTS_HEARTBEAT_INTERVAL_MS = 15_000
const DEFAULT_MOBILE_DEVICE_CAPABILITIES = [
  "workspace:read",
  "session:read",
  "session:create",
  "message:send",
  "task:cancel",
  "approval:read",
  "approval:respond",
  "workspace-file:read",
]

export interface MobileBridgeStatus {
  running: boolean
  host: string
  port: number | null
  token: string
  publicUrl: string | null
  localUrl: string | null
  urls: string[]
  publicPairingUrl: string | null
  pairingLocalUrl: string | null
  pairingUrls: string[]
  pairingExpiresAt: number | null
  startedAt: number | null
  devices: MobileDeviceSummary[]
  cloudRelay: DesktopCloudRelayStatus
}

export interface MobileDeviceSummary {
  id: string
  name: string
  createdAt: number
  lastSeenAt: number
  revokedAt?: number
  capabilities: string[]
}

interface MobileDeviceRecord {
  id: string
  name: string
  createdAt: number
  lastSeenAt: number
  tokenHash: string
  revokedAt?: number
  capabilities: string[]
}

interface MobileDevicesDocument {
  version: 1
  devices: MobileDeviceRecord[]
}

interface AnyboxProviderRelaySession {
  connected: boolean
  status: string
  accessToken?: string
  baseURL?: string
  expiresAt?: number
  account?: {
    email?: string
    workspaceName?: string
    planLabel?: string
    entitlements?: {
      modelGatewayEnabled?: boolean
      relayEnabled?: boolean
      maxDesktopDevices?: number
      maxMobileDevices?: number
    }
  }
}

interface MobilePairingCode {
  code: string
  createdAt: number
  expiresAt: number
}

interface LanHostCandidate {
  address: string
  interfaceName: string
  priority: number
}

type MobileAuthorization =
  | {
      kind: "bridge-token"
    }
  | {
      kind: "device-token"
      device: MobileDeviceRecord
    }

let server: http.Server | undefined
let bridgeHost = readBridgeHost()
let bridgePort: number | null = null
let bridgeToken = createBridgeToken()
let startedAt: number | null = null
let mobileDevicesDocument: MobileDevicesDocument | null = null
let mobilePairingCode: MobilePairingCode | null = null
let mobileTunnelProcess: ChildProcess | undefined
let mobileTunnelLastStartAt = 0

function readBridgeHost() {
  const configured = process.env[MOBILE_BRIDGE_HOST_ENV]?.trim()
  return configured || DEFAULT_MOBILE_BRIDGE_HOST
}

function readBridgePort() {
  const configured = process.env[MOBILE_BRIDGE_PORT_ENV]?.trim()
  if (!configured) return DEFAULT_MOBILE_BRIDGE_PORT
  const parsed = Number(configured)
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : DEFAULT_MOBILE_BRIDGE_PORT
}

function readBridgePublicBaseUrl() {
  const configured = process.env[MOBILE_BRIDGE_PUBLIC_URL_ENV]
  const raw = configured === undefined ? DEFAULT_MOBILE_BRIDGE_PUBLIC_URL : configured.trim()
  if (!raw || /^(0|false|no|none|off)$/i.test(raw)) return null

  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null
    return parsed.origin
  } catch {
    return null
  }
}

function isDisabledEnvValue(value: string | undefined) {
  return value ? /^(0|false|no|none|off)$/i.test(value.trim()) : false
}

function readBridgeTunnelTarget() {
  return process.env[MOBILE_BRIDGE_TUNNEL_TARGET_ENV]?.trim() || "anybox-server"
}

function sanitizeDesktopDeviceName(value: string | null | undefined) {
  const normalized = value?.trim().replace(/\s+/g, " ").replace(/\.local$/i, "")
  return normalized ? normalized.slice(0, 80) : null
}

function getDesktopDeviceName() {
  return (
    sanitizeDesktopDeviceName(process.env[DESKTOP_DEVICE_NAME_ENV]) ??
    sanitizeDesktopDeviceName(os.hostname()) ??
    sanitizeDesktopDeviceName(app.getName()) ??
    "Desktop"
  )
}

function shouldStartBridgeTunnel() {
  return Boolean(readBridgePublicBaseUrl()) && !isDisabledEnvValue(process.env[MOBILE_BRIDGE_TUNNEL_ENV])
}

function shouldRefreshRelayPairing(status: DesktopCloudRelayStatus, now = Date.now()) {
  if (!status.enabled || status.state !== "connected") return false
  if (!status.pairingDeepLink || !status.pairingExpiresAt) return true
  return status.pairingExpiresAt <= now
}

async function getAnyboxProviderRelaySession() {
  const result = await requestAgentJSON<AnyboxProviderRelaySession>("/api/providers/anybox/auth/relay-session")
  const session = result.data
  if (!session.connected || !session.accessToken) return null
  return {
    accessToken: session.accessToken,
    baseUrl: session.baseURL,
    email: session.account?.email,
    workspaceName: session.account?.workspaceName,
    planLabel: session.account?.planLabel,
    entitlements: session.account?.entitlements,
    expiresAt: session.expiresAt,
  }
}

function createBridgeToken() {
  return randomBytes(24).toString("base64url")
}

function createDeviceID() {
  return `device_${randomBytes(12).toString("base64url")}`
}

function createDeviceToken() {
  return `mobile_${randomBytes(32).toString("base64url")}`
}

function createPairingCode() {
  return randomBytes(18).toString("base64url")
}

function hashToken(value: string) {
  return createHash("sha256").update(value).digest()
}

function hashTokenHex(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

function tokenMatches(candidate: string | undefined) {
  if (!candidate) return false
  return timingSafeEqual(hashToken(candidate), hashToken(bridgeToken))
}

function getCurrentPairingCode(now = Date.now()) {
  if (!mobilePairingCode || mobilePairingCode.expiresAt <= now) {
    mobilePairingCode = {
      code: createPairingCode(),
      createdAt: now,
      expiresAt: now + MOBILE_PAIRING_CODE_TTL_MS,
    }
  }
  return mobilePairingCode
}

function consumePairingCode(candidate: string | undefined, now = Date.now()) {
  if (!candidate || !mobilePairingCode || mobilePairingCode.expiresAt <= now) return false
  const candidateHash = hashToken(candidate)
  const currentHash = hashToken(mobilePairingCode.code)
  const matches = candidateHash.length === currentHash.length && timingSafeEqual(candidateHash, currentHash)
  if (matches) {
    mobilePairingCode = null
  }
  return matches
}

function inspectPairingCode(candidate: string | undefined, now = Date.now()) {
  const current = mobilePairingCode
  if (!candidate || !current) return { valid: false, expiresAt: null }
  if (current.expiresAt <= now) return { valid: false, expiresAt: current.expiresAt }
  const candidateHash = hashToken(candidate)
  const currentHash = hashToken(current.code)
  const valid = candidateHash.length === currentHash.length && timingSafeEqual(candidateHash, currentHash)
  return {
    valid,
    expiresAt: valid ? current.expiresAt : null,
  }
}

function tokenHashMatches(candidate: string, tokenHash: string) {
  const candidateHash = Buffer.from(hashTokenHex(candidate), "hex")
  const storedHash = Buffer.from(tokenHash, "hex")
  return candidateHash.length === storedHash.length && timingSafeEqual(candidateHash, storedHash)
}

function readRequestToken(request: http.IncomingMessage, url: URL) {
  const authorization = request.headers.authorization
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return authorization.slice("bearer ".length).trim()
  }
  return url.searchParams.get(TOKEN_QUERY_PARAM)?.trim() || undefined
}

function getMobileDevicesPath() {
  return path.join(app.getPath("userData"), MOBILE_DEVICES_FILE_NAME)
}

function getMobileHandoffPath() {
  return path.join(app.getPath("userData"), MOBILE_HANDOFF_FILE_NAME)
}

function normalizeMobileDeviceRecord(value: unknown): MobileDeviceRecord | null {
  if (!value || typeof value !== "object") return null
  const record = value as Partial<MobileDeviceRecord>
  if (
    typeof record.id !== "string" ||
    typeof record.name !== "string" ||
    typeof record.createdAt !== "number" ||
    typeof record.lastSeenAt !== "number" ||
    typeof record.tokenHash !== "string"
  ) {
    return null
  }

  return {
    id: record.id,
    name: record.name,
    createdAt: record.createdAt,
    lastSeenAt: record.lastSeenAt,
    tokenHash: record.tokenHash,
    ...(typeof record.revokedAt === "number" ? { revokedAt: record.revokedAt } : {}),
    capabilities: Array.isArray(record.capabilities)
      ? record.capabilities.filter((capability): capability is string => typeof capability === "string")
      : DEFAULT_MOBILE_DEVICE_CAPABILITIES,
  }
}

function normalizeMobileDevicesDocument(value: unknown): MobileDevicesDocument {
  if (!value || typeof value !== "object") return { version: 1, devices: [] }
  const devices = Array.isArray((value as { devices?: unknown }).devices)
    ? (value as { devices: unknown[] }).devices
        .map(normalizeMobileDeviceRecord)
        .filter((device): device is MobileDeviceRecord => Boolean(device))
    : []
  return {
    version: 1,
    devices,
  }
}

async function readMobileDevicesDocument() {
  if (mobileDevicesDocument) return mobileDevicesDocument
  try {
    const raw = await fs.readFile(getMobileDevicesPath(), "utf8")
    mobileDevicesDocument = normalizeMobileDevicesDocument(JSON.parse(raw) as unknown)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      safeError("[desktop][mobile-bridge] failed to read mobile devices", error)
    }
    mobileDevicesDocument = { version: 1, devices: [] }
  }
  return mobileDevicesDocument
}

async function writeMobileDevicesDocument(document: MobileDevicesDocument) {
  mobileDevicesDocument = document
  const filePath = getMobileDevicesPath()
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(document, null, 2)}\n`, "utf8")
}

async function authorizeMobileRequest(request: http.IncomingMessage, url: URL): Promise<MobileAuthorization | null> {
  const token = readRequestToken(request, url)
  if (!token) return null
  if (tokenMatches(token)) return { kind: "bridge-token" }

  const document = await readMobileDevicesDocument()
  const device = document.devices.find((candidate) => !candidate.revokedAt && tokenHashMatches(token, candidate.tokenHash))
  if (!device) return null

  const now = Date.now()
  if (now - device.lastSeenAt > DEVICE_LAST_SEEN_WRITE_INTERVAL_MS) {
    device.lastSeenAt = now
    await writeMobileDevicesDocument(document)
  }

  return {
    kind: "device-token",
    device,
  }
}

function mobileAuthorizationHasCapability(authorization: MobileAuthorization, capability: string) {
  return authorization.kind === "bridge-token" || authorization.device.capabilities.includes(capability)
}

function requireMobileCapabilities(
  authorization: MobileAuthorization,
  response: http.ServerResponse,
  capabilities: readonly string[],
) {
  const missingCapability = capabilities.find((capability) => !mobileAuthorizationHasCapability(authorization, capability))
  if (!missingCapability) return true

  jsonResponse(
    response,
    403,
    errorBody(
      "FORBIDDEN",
      `This paired mobile device is missing the "${missingCapability}" capability. Re-pair it from desktop settings to refresh permissions.`,
    ),
  )
  return false
}

function auditMobileBridgeAction(
  authorization: MobileAuthorization,
  action: string,
  details?: Record<string, unknown>,
) {
  safeLog("[desktop][mobile-bridge][audit]", {
    action,
    actor:
      authorization.kind === "device-token"
        ? {
            kind: "device",
            deviceID: authorization.device.id,
            deviceName: authorization.device.name,
          }
        : {
            kind: "bridge-token",
          },
    at: Date.now(),
    ...details,
  })
}

function auditMobileDevicePaired(device: MobileDeviceSummary) {
  safeLog("[desktop][mobile-bridge][audit]", {
    action: "device.pair",
    actor: {
      kind: "device",
      deviceID: device.id,
      deviceName: device.name,
    },
    at: Date.now(),
  })
}

function sanitizeDeviceName(input: unknown) {
  const value = typeof input === "string" ? input.trim() : ""
  return value.slice(0, 80) || "Android device"
}

function serializeMobileDevice(device: MobileDeviceRecord): MobileDeviceSummary {
  return {
    id: device.id,
    name: device.name,
    createdAt: device.createdAt,
    lastSeenAt: device.lastSeenAt,
    revokedAt: device.revokedAt,
    capabilities: device.capabilities,
  }
}

async function listMobileDeviceSummaries() {
  const document = await readMobileDevicesDocument()
  return document.devices
    .map(serializeMobileDevice)
    .sort((left, right) => {
      if (Boolean(left.revokedAt) !== Boolean(right.revokedAt)) return left.revokedAt ? 1 : -1
      return right.lastSeenAt - left.lastSeenAt
    })
}

async function pairMobileDevice(request: http.IncomingMessage) {
  const body = await readRequestBody(request)
  const parsed = body.trim() ? (JSON.parse(body) as { name?: unknown }) : {}
  const token = createDeviceToken()
  const now = Date.now()
  const device: MobileDeviceRecord = {
    id: createDeviceID(),
    name: sanitizeDeviceName(parsed.name),
    createdAt: now,
    lastSeenAt: now,
    tokenHash: hashTokenHex(token),
    capabilities: DEFAULT_MOBILE_DEVICE_CAPABILITIES,
  }
  const document = await readMobileDevicesDocument()
  document.devices = [device, ...document.devices.filter((candidate) => !candidate.revokedAt)]
  await writeMobileDevicesDocument(document)
  return {
    token,
    device: serializeMobileDevice(device),
  }
}

function readRequestBody(request: http.IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []
    request.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    request.on("error", reject)
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
  })
}

function requestOrigin(request: http.IncomingMessage) {
  const origin = request.headers.origin
  return typeof origin === "string" ? origin.trim() : ""
}

function requestOwnOrigin(request: http.IncomingMessage) {
  const host = typeof request.headers.host === "string" ? request.headers.host.trim() : ""
  return host ? `http://${host}` : ""
}

function isAllowedMobileBridgeOrigin(request: http.IncomingMessage) {
  const origin = requestOrigin(request)
  if (!origin) return true
  return origin === requestOwnOrigin(request)
}

function writeMobileCorsHeaders(request: http.IncomingMessage, response: http.ServerResponse) {
  const origin = requestOrigin(request)
  const ownOrigin = requestOwnOrigin(request)
  if (origin && origin === ownOrigin) {
    response.setHeader("access-control-allow-origin", origin)
    response.setHeader("vary", "Origin")
  }
  response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS")
  response.setHeader("access-control-allow-headers", "authorization, content-type")
  response.setHeader("access-control-max-age", "600")
}

function jsonResponse(response: http.ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  })
  response.end(`${JSON.stringify(body)}\n`)
}

function textResponse(response: http.ServerResponse, status: number, body: string, contentType: string) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": contentType,
    "x-content-type-options": "nosniff",
  })
  response.end(body)
}

function writeSSEHeaders(response: http.ServerResponse) {
  response.writeHead(200, {
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "content-type": "text/event-stream; charset=utf-8",
    "x-accel-buffering": "no",
    "x-content-type-options": "nosniff",
  })
  response.flushHeaders?.()
}

function writeSSEEvent(response: http.ServerResponse, event: string, data: unknown, id?: string) {
  if (id) response.write(`id: ${id}\n`)
  response.write(`event: ${event}\n`)
  const serialized = JSON.stringify(data)
  for (const line of serialized.split(/\r?\n/)) {
    response.write(`data: ${line}\n`)
  }
  response.write("\n")
}

function writeSSEComment(response: http.ServerResponse, comment: string) {
  response.write(`: ${comment}\n\n`)
}

function ok(data: unknown) {
  return {
    success: true,
    data,
  }
}

function errorBody(code: string, message: string) {
  return {
    success: false,
    error: { code, message },
  }
}

function copyResponseHeaders(source: Response, target: http.ServerResponse) {
  const contentType = source.headers.get("content-type")
  if (contentType) target.setHeader("content-type", contentType)
  target.setHeader("cache-control", source.headers.get("cache-control") ?? "no-store")
  target.setHeader("x-content-type-options", "nosniff")
  const requestId = source.headers.get("x-request-id")
  if (requestId) target.setHeader("x-request-id", requestId)
}

async function streamFetchResponse(source: Response, target: http.ServerResponse) {
  target.statusCode = source.status
  copyResponseHeaders(source, target)

  if (!source.body) {
    target.end(await source.text().catch(() => ""))
    return
  }

  const reader = source.body.getReader()
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      if (chunk.value) target.write(Buffer.from(chunk.value))
    }
  } finally {
    target.end()
    reader.releaseLock()
  }
}

function sanitizedSearch(url: URL) {
  const params = new URLSearchParams(url.search)
  params.delete(TOKEN_QUERY_PARAM)
  params.delete(PAIRING_CODE_QUERY_PARAM)
  const value = params.toString()
  return value ? `?${value}` : ""
}

async function proxyAgentRequest(request: http.IncomingMessage, response: http.ServerResponse, agentPath: string) {
  const headers: HeadersInit = {}
  const contentType = request.headers["content-type"]
  if (typeof contentType === "string") headers["content-type"] = contentType

  const method = request.method ?? "GET"
  const body = method === "GET" || method === "HEAD" ? undefined : await readRequestBody(request)
  const agentResponse = await fetch(resolveAgentURL(agentPath), {
    method,
    headers,
    body,
  })

  await streamFetchResponse(agentResponse, response)
}

function mobileAgentPath(url: URL) {
  const segments = url.pathname.split("/").filter(Boolean)
  if (segments[0] !== "api" || segments[1] !== "mobile") return undefined

  const resource = segments[2]
  if (resource === "projects" && segments.length === 3) {
    return "/api/projects"
  }

  if (resource === "projects" && segments.length === 5 && segments[4] === "sessions") {
    return `/api/projects/${segments[3]}/sessions${sanitizedSearch(url)}`
  }

  if (resource === "sessions" && segments.length >= 4) {
    const sessionID = segments[3]
    const action = segments.slice(4).join("/")

    if (action === "messages") return `/api/sessions/${sessionID}/messages${sanitizedSearch(url)}`
    if (action === "messages/stream") return `/api/sessions/${sessionID}/messages/stream${sanitizedSearch(url)}`
    if (action === "resume/stream") return `/api/sessions/${sessionID}/resume/stream${sanitizedSearch(url)}`
    if (action === "events/stream") return `/api/sessions/${sessionID}/events/stream${sanitizedSearch(url)}`
    if (action === "cancel") return `/api/sessions/${sessionID}/cancel`
    if (action === "tasks") return `/api/sessions/${sessionID}/tasks${sanitizedSearch(url)}`
    if (action === "models") return `/api/sessions/${sessionID}/models${sanitizedSearch(url)}`
    if (action === "model-selection") return `/api/sessions/${sessionID}/model-selection`
    if (action === "questions/answer") return `/api/sessions/${sessionID}/questions/answer`
  }

  return undefined
}

function mobileAgentRouteCapability(url: URL, method: string) {
  const segments = url.pathname.split("/").filter(Boolean)
  if (segments[0] !== "api" || segments[1] !== "mobile") return undefined

  const resource = segments[2]
  if (resource === "projects" && segments.length === 3) {
    return "workspace:read"
  }

  if (resource === "projects" && segments.length === 5 && segments[4] === "sessions") {
    return method === "POST" ? "session:create" : "session:read"
  }

  if (resource === "sessions" && segments.length >= 4) {
    const action = segments.slice(4).join("/")

    if (action === "messages") return method === "GET" ? "session:read" : "message:send"
    if (action === "messages/stream") return "message:send"
    if (action === "resume/stream") return "message:send"
    if (action === "events/stream") return "session:read"
    if (action === "cancel") return "task:cancel"
    if (action === "tasks") return "session:read"
    if (action === "models") return "session:read"
    if (action === "model-selection") return "session:read"
    if (action === "questions/answer") return "message:send"
  }

  return undefined
}

function mobileAgentRouteAudit(url: URL, method: string) {
  const segments = url.pathname.split("/").filter(Boolean)
  const resource = segments[2]
  if (resource === "projects" && segments.length === 3) {
    return { action: "projects.list" }
  }

  if (resource === "projects" && segments.length === 5 && segments[4] === "sessions") {
    return {
      action: method === "POST" ? "session.create.legacy" : "sessions.list.legacy",
      projectID: segments[3],
    }
  }

  if (resource === "sessions" && segments.length >= 4) {
    const sessionID = segments[3]
    const routeAction = segments.slice(4).join("/")
    const action =
      routeAction === "messages"
        ? method === "GET"
          ? "messages.read"
          : "message.send"
        : routeAction === "messages/stream"
          ? "message.send"
          : routeAction === "resume/stream"
            ? "session.resume"
            : routeAction === "events/stream"
              ? "session.events.open"
              : routeAction === "cancel"
                ? "session.cancel"
                : routeAction === "tasks"
                  ? "tasks.read"
                  : routeAction === "models"
                    ? "models.read"
                    : routeAction === "model-selection"
                      ? "model.selection.update"
                      : routeAction === "questions/answer"
                        ? "question.answer"
                        : "agent.proxy"

    return {
      action,
      sessionID,
    }
  }

  return { action: "agent.proxy" }
}

function mobileAgentRouteDesktopEvent(url: URL, method: string): Omit<MobileBridgeDesktopEvent, "generatedAt" | "source"> | null {
  const segments = url.pathname.split("/").filter(Boolean)
  if (segments[0] !== "api" || segments[1] !== "mobile" || segments[2] !== "sessions" || segments.length < 5) {
    return null
  }

  const sessionID = segments[3]
  const action = segments.slice(4).join("/")
  if (!sessionID) return null
  if (method === "PATCH" && action === "model-selection") {
    return {
      type: "session.updated",
      sessionID,
    }
  }
  if (method !== "POST") return null
  if (action === "messages" || action === "messages/stream" || action === "resume/stream" || action === "cancel" || action === "questions/answer") {
    return {
      type: "session.updated",
      sessionID,
    }
  }

  return null
}

function mobileWorkspaceFilesAuditDetails(url: URL) {
  const match = url.pathname.match(/^\/api\/mobile\/workspaces\/([^/]+)\/files(?:\/(content|search))?$/)
  const encodedWorkspaceID = match?.[1]
  const action = match?.[2]
  return {
    action: action === "content" ? "workspace.file.read" : action === "search" ? "workspace.files.search" : "workspace.files.list",
    workspaceID: encodedWorkspaceID ? decodeURIComponent(encodedWorkspaceID) : undefined,
    path: url.searchParams.get("path")?.trim() || undefined,
    query: url.searchParams.get("q")?.trim() || undefined,
  }
}

function mobileWorkspaceFilesAgentPath(url: URL) {
  const match = url.pathname.match(/^\/api\/mobile\/workspaces\/([^/]+)\/files(?:\/(content|search))?$/)
  if (!match) return undefined

  const [, encodedWorkspaceID, action] = match
  if (!encodedWorkspaceID) return undefined

  const params = new URLSearchParams()
  params.set("directory", decodeURIComponent(encodedWorkspaceID))

  if (action === "content") {
    params.set("path", url.searchParams.get("path")?.trim() ?? "")
    return `/api/workspace-files/file?${params.toString()}`
  }

  if (action === "search") {
    params.set("query", url.searchParams.get("q")?.trim() ?? "")
    return `/api/workspace-files/search?${params.toString()}`
  }

  const directoryPath = url.searchParams.get("path")?.trim()
  if (directoryPath) params.set("path", directoryPath)
  return `/api/workspace-files/directory?${params.toString()}`
}

function mobileWorkspaceSessionsRoute(url: URL) {
  const match = url.pathname.match(/^\/api\/mobile\/workspaces\/([^/]+)\/sessions$/)
  const encodedWorkspaceID = match?.[1]
  return encodedWorkspaceID ? decodeURIComponent(encodedWorkspaceID) : undefined
}

function mobileWorkspaceDiffRoute(url: URL) {
  const match = url.pathname.match(/^\/api\/mobile\/workspaces\/([^/]+)\/diff$/)
  const encodedWorkspaceID = match?.[1]
  return encodedWorkspaceID ? decodeURIComponent(encodedWorkspaceID) : undefined
}

function publicStatus() {
  return {
    service: "anybox-mobile-bridge",
    running: Boolean(server),
    desktopName: getDesktopDeviceName(),
    appVersion: app.getVersion(),
    online: Boolean(server),
    capabilities: DEFAULT_MOBILE_DEVICE_CAPABILITIES,
  }
}

function mapMobileSession(session: AgentSessionInfo) {
  return {
    id: session.id,
    projectID: session.projectID,
    worktreeID: session.worktreeID,
    directory: session.directory,
    title: session.title,
    kind: session.kind,
    policy: session.policy,
    automation: session.automation,
    origin: session.origin,
    subagent: session.subagent,
    modelSelection: session.modelSelection,
    created: session.time.created,
    updated: session.time.updated,
    workflow: session.workflow,
  }
}

async function loadMobileProjectWorkspace(project: AgentProjectInfo): Promise<AgentProjectWorkspace> {
  const sessions = await requestAgentJSON<AgentSessionInfo[]>(`/api/projects/${encodeURIComponent(project.id)}/sessions`)
  return {
    ...project,
    sessions: sessions.data.map(mapMobileSession).sort((left, right) => right.updated - left.updated),
  }
}

async function listMobileFolderWorkspaces() {
  const projects = await requestAgentJSON<AgentProjectInfo[]>("/api/projects")
  const projectWorkspaces = await Promise.all(projects.data.map((project) => loadMobileProjectWorkspace(project)))
  return buildFolderWorkspaces(projects.data, projectWorkspaces)
}

async function getMobileWorkspace(workspaceID: string) {
  const workspaces = await listMobileFolderWorkspaces()
  return workspaces.find((workspace) => workspace.id === workspaceID) ?? null
}

async function listMobileWorkspaceSessions(workspaceID: string) {
  const workspace = await getMobileWorkspace(workspaceID)
  return workspace?.sessions ?? null
}

async function createMobileWorkspaceSession(workspaceID: string, request: http.IncomingMessage) {
  const workspace = await getMobileWorkspace(workspaceID)
  if (!workspace) return null

  const body = await readRequestBody(request)
  const parsed = body.trim() ? (JSON.parse(body) as { title?: unknown }) : {}
  const title = typeof parsed.title === "string" ? parsed.title.trim() : ""
  const result = await requestAgentJSON<AgentSessionInfo>(`/api/projects/${encodeURIComponent(workspace.project.id)}/sessions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      title: title || undefined,
      directory: workspace.directory,
    }),
  })
  return mapMobileSession(result.data)
}

async function getMobileWorkspaceDiff(workspaceID: string) {
  const workspace = await getMobileWorkspace(workspaceID)
  if (!workspace) return undefined
  const summary = await getWorkspaceGitDiff(workspace.directory)
  return summary ?? null
}

async function listMobileApprovals(url: URL) {
  const params = new URLSearchParams()
  params.set("status", url.searchParams.get("status") || "pending")
  params.set("view", "prompt")
  const sessionID = url.searchParams.get("sessionID")?.trim()
  if (sessionID) params.set("sessionID", sessionID)
  const result = await requestAgentJSON<unknown[]>(`/api/permissions/requests?${params.toString()}`)
  return result.data
}

interface MobileEventsSnapshot {
  generatedAt: number
  workspaces: AgentFolderWorkspace[]
  approvals: unknown[]
  workspaceSignatures: Map<string, string>
  sessionSignatures: Map<string, string>
  approvalSignatures: Map<string, string>
}

function stableEventSignature(value: unknown) {
  return JSON.stringify(value)
}

function workspaceEventSignature(workspace: AgentFolderWorkspace) {
  return stableEventSignature({
    id: workspace.id,
    directory: workspace.directory,
    exists: workspace.exists,
    updated: workspace.updated,
    sessions: workspace.sessions.map((session) => ({
      id: session.id,
      updated: session.updated,
      workflow: session.workflow,
    })),
  })
}

function sessionEventSignature(session: AgentWorkspaceSession) {
  return stableEventSignature({
    id: session.id,
    title: session.title,
    directory: session.directory,
    updated: session.updated,
    workflow: session.workflow,
  })
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function approvalEventID(value: unknown) {
  const record = readRecord(value)
  if (!record) return null
  const id = record.id ?? record.approvalID
  return typeof id === "string" && id.trim() ? id : null
}

function approvalEventSignature(value: unknown) {
  const record = readRecord(value)
  if (!record) return stableEventSignature(value)
  return stableEventSignature({
    id: record.id,
    approvalID: record.approvalID,
    status: record.status,
    createdAt: record.createdAt,
    prompt: record.prompt,
    resolution: record.resolution,
  })
}

async function loadMobileEventsSnapshot(url: URL): Promise<MobileEventsSnapshot> {
  const [workspaces, approvals] = await Promise.all([listMobileFolderWorkspaces(), listMobileApprovals(url)])
  return {
    generatedAt: Date.now(),
    workspaces,
    approvals,
    workspaceSignatures: new Map(workspaces.map((workspace) => [workspace.id, workspaceEventSignature(workspace)])),
    sessionSignatures: new Map(
      workspaces.flatMap((workspace) => workspace.sessions.map((session) => [session.id, sessionEventSignature(session)] as const)),
    ),
    approvalSignatures: new Map(
      approvals.flatMap((approval) => {
        const id = approvalEventID(approval)
        return id ? ([[id, approvalEventSignature(approval)]] as const) : []
      }),
    ),
  }
}

function streamMobileEvents(request: http.IncomingMessage, response: http.ServerResponse, url: URL) {
  writeSSEHeaders(response)

  let closed = false
  let previous: MobileEventsSnapshot | null = null
  let sequence = 0

  const nextEventID = () => `${Date.now()}-${++sequence}`
  const canWrite = () => !closed && !response.destroyed && !response.writableEnded
  const send = (event: string, data: unknown) => {
    if (!canWrite()) return
    writeSSEEvent(response, event, data, nextEventID())
  }

  const sendSnapshotChanges = (next: MobileEventsSnapshot) => {
    if (!previous) {
      send("sync.ready", { type: "sync.ready", generatedAt: next.generatedAt })
      previous = next
      return
    }

    let changed = false

    for (const workspace of next.workspaces) {
      const oldSignature = previous.workspaceSignatures.get(workspace.id)
      const newSignature = next.workspaceSignatures.get(workspace.id)
      if (oldSignature !== newSignature) {
        changed = true
        send("workspace.updated", { type: "workspace.updated", workspace, generatedAt: next.generatedAt })
      }
    }

    for (const workspace of next.workspaces) {
      for (const session of workspace.sessions) {
        const oldSignature = previous.sessionSignatures.get(session.id)
        const newSignature = next.sessionSignatures.get(session.id)
        if (!oldSignature) {
          changed = true
          send("session.created", { type: "session.created", session, workspaceID: workspace.id, generatedAt: next.generatedAt })
        } else if (oldSignature !== newSignature) {
          changed = true
          send("session.updated", { type: "session.updated", session, workspaceID: workspace.id, generatedAt: next.generatedAt })
        }
      }
    }

    for (const approval of next.approvals) {
      const approvalID = approvalEventID(approval)
      if (!approvalID) continue
      const oldSignature = previous.approvalSignatures.get(approvalID)
      const newSignature = next.approvalSignatures.get(approvalID)
      if (!oldSignature) {
        changed = true
        send("approval.requested", { type: "approval.requested", approval, generatedAt: next.generatedAt })
      } else if (oldSignature !== newSignature) {
        changed = true
        send("approval.updated", { type: "approval.updated", approval, generatedAt: next.generatedAt })
      }
    }

    for (const approvalID of previous.approvalSignatures.keys()) {
      if (next.approvalSignatures.has(approvalID)) continue
      changed = true
      send("approval.updated", { type: "approval.updated", approvalID, status: "resolved", generatedAt: next.generatedAt })
    }

    if (changed) {
      send("sync.updated", { type: "sync.updated", generatedAt: next.generatedAt })
    }

    previous = next
  }

  const refresh = async () => {
    if (!canWrite()) return
    try {
      sendSnapshotChanges(await loadMobileEventsSnapshot(url))
    } catch (error) {
      safeError("[desktop][mobile-bridge] mobile events refresh failed", error)
      send("sync.error", {
        type: "sync.error",
        message: error instanceof Error ? error.message : "Mobile event refresh failed.",
        generatedAt: Date.now(),
      })
    }
  }

  void refresh()
  const pollTimer = setInterval(() => {
    void refresh()
  }, MOBILE_EVENTS_POLL_INTERVAL_MS)
  const heartbeatTimer = setInterval(() => {
    if (canWrite()) writeSSEComment(response, "ping")
  }, MOBILE_EVENTS_HEARTBEAT_INTERVAL_MS)

  return new Promise<void>((resolve) => {
    const cleanup = () => {
      if (closed) return
      closed = true
      clearInterval(pollTimer)
      clearInterval(heartbeatTimer)
      resolve()
    }
    request.on("close", cleanup)
    response.on("close", cleanup)
  })
}

async function resolveMobileApproval(requestID: string, decision: "allow" | "deny", request: http.IncomingMessage) {
  const rawBody = await readRequestBody(request)
  const parsed = rawBody.trim() ? (JSON.parse(rawBody) as { note?: unknown; resume?: unknown }) : {}
  const result = await requestAgentJSON<unknown>(`/api/permissions/requests/${encodeURIComponent(requestID)}/resolve`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      decision,
      note: typeof parsed.note === "string" ? parsed.note : undefined,
      resume: typeof parsed.resume === "boolean" ? parsed.resume : true,
    }),
  })
  return result.data
}

function readIPv4Octets(address: string) {
  const octets = address.split(".").map((part) => Number(part))
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null
  return octets as [number, number, number, number]
}

function isReservedMobileBridgeIPv4(address: string) {
  const octets = readIPv4Octets(address)
  if (!octets) return true
  const [first, second, third] = octets

  return (
    first === 0 ||
    first === 127 ||
    first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 192 && second === 88 && third === 99) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113)
  )
}

function interfacePriority(interfaceName: string) {
  if (/\b(vethernet|virtual|vmware|virtualbox|hyper-v|docker|wsl|tailscale|zerotier|wireguard|clash|vpn|loopback|bluetooth)\b/i.test(interfaceName)) {
    return null
  }
  if (/wi-?fi|wlan|wireless|ethernet|以太网|无线/i.test(interfaceName)) return 0
  return 1
}

function addressPriority(address: string) {
  const octets = readIPv4Octets(address)
  if (!octets) return 9
  const [first, second] = octets
  if (first === 192 && second === 168) return 0
  if (first === 10) return 1
  if (first === 172 && second >= 16 && second <= 31) return 2
  return 8
}

function listLanHosts() {
  const candidates: LanHostCandidate[] = []
  for (const [interfaceName, entries] of Object.entries(os.networkInterfaces())) {
    const priority = interfacePriority(interfaceName)
    if (priority === null) continue

    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue
      if (isReservedMobileBridgeIPv4(entry.address)) continue
      candidates.push({
        address: entry.address,
        interfaceName,
        priority: priority * 10 + addressPriority(entry.address),
      })
    }
  }

  const seen = new Set<string>()
  const addresses: string[] = []
  for (const candidate of candidates.sort((left, right) => left.priority - right.priority || left.interfaceName.localeCompare(right.interfaceName) || left.address.localeCompare(right.address))) {
    if (seen.has(candidate.address)) continue
    seen.add(candidate.address)
    addresses.push(candidate.address)
  }
  return addresses
}

function urlWithToken(host: string, port: number) {
  return `http://${host}:${port}/?${TOKEN_QUERY_PARAM}=${encodeURIComponent(bridgeToken)}`
}

function urlWithPairingCode(host: string, port: number, code: string) {
  return `http://${host}:${port}/?${PAIRING_CODE_QUERY_PARAM}=${encodeURIComponent(code)}`
}

function publicUrlWithToken(baseUrl: string) {
  const url = new URL(baseUrl)
  url.searchParams.set(TOKEN_QUERY_PARAM, bridgeToken)
  return url.toString()
}

function publicUrlWithPairingCode(baseUrl: string, code: string) {
  const url = new URL(baseUrl)
  url.searchParams.set(PAIRING_CODE_QUERY_PARAM, code)
  return url.toString()
}

function createPairingDeepLink(url: string) {
  return `anybox-mobile://connect?url=${encodeURIComponent(url)}`
}

function createConnectionOptionsDeepLink(input: { relayDeepLink?: string | null; lanUrl?: string | null; fallbackUrl?: string | null }) {
  const params = new URLSearchParams()
  if (input.relayDeepLink) params.set("relay", input.relayDeepLink)
  if (input.lanUrl) params.set("lan", input.lanUrl)
  if (params.toString()) return `anybox-mobile://connect-options?${params.toString()}`
  return input.fallbackUrl ? createPairingDeepLink(input.fallbackUrl) : ""
}

function ensureMobileBridgeTunnelRunning(port: number | null) {
  if (!port || mobileTunnelProcess || !shouldStartBridgeTunnel()) return
  const now = Date.now()
  if (now - mobileTunnelLastStartAt < 10_000) return
  mobileTunnelLastStartAt = now

  const target = readBridgeTunnelTarget()
  const remoteForward = `127.0.0.1:${port}:127.0.0.1:${port}`
  const child = spawn("ssh", [
    "-N",
    "-T",
    "-o",
    "BatchMode=yes",
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=3",
    "-R",
    remoteForward,
    target,
  ], {
    stdio: "ignore",
    windowsHide: true,
  })

  mobileTunnelProcess = child
  child.once("error", (error) => {
    if (mobileTunnelProcess === child) mobileTunnelProcess = undefined
    safeWarn("[desktop][mobile-bridge] failed to start SSH reverse tunnel", {
      error: safeErrorMessage(error),
      target,
    })
  })
  child.once("exit", (code, signal) => {
    if (mobileTunnelProcess === child) mobileTunnelProcess = undefined
    safeWarn("[desktop][mobile-bridge] SSH reverse tunnel exited", {
      code,
      signal,
      target,
    })
  })
}

function safeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function broadcastMobileBridgeDesktopEvent(
  input: Omit<MobileBridgeDesktopEvent, "generatedAt" | "source"> & { generatedAt?: number },
) {
  const mobileEvent: MobileBridgeDesktopEvent = {
    ...input,
    source: "mobile",
    generatedAt: input.generatedAt ?? Date.now(),
  }

  for (const win of BrowserWindow.getAllWindows()) {
    const webContents = getWebContentsForWindowSafely(win)
    if (!webContents) continue
    sendWebContentsSafely(webContents, DESKTOP_MOBILE_BRIDGE_EVENT_CHANNEL, mobileEvent)
  }
}

function stopMobileBridgeTunnel() {
  const current = mobileTunnelProcess
  mobileTunnelProcess = undefined
  if (!current || current.killed) return
  current.kill()
}

function quotePowerShellArgument(value: string) {
  return `"${value.replace(/`/g, "``").replace(/"/g, '`"')}"`
}

function isLoopbackBridgeHost(host: string) {
  const normalized = host.toLowerCase()
  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1"
}

async function writeMobileHandoffFile(status: MobileBridgeStatus) {
  const now = Date.now()
  const relayPairingDeepLink = status.cloudRelay.enabled && status.cloudRelay.pairingExpiresAt && status.cloudRelay.pairingExpiresAt > now
    ? status.cloudRelay.pairingDeepLink
    : null
  const lanPairingUrl = isLoopbackBridgeHost(status.host) ? null : status.pairingUrls[0] ?? null
  const primaryPairingUrl = status.publicPairingUrl ?? (isLoopbackBridgeHost(status.host) ? status.pairingLocalUrl : status.pairingUrls[0])
  const pairingExpiries = [
    relayPairingDeepLink ? status.cloudRelay.pairingExpiresAt ?? null : null,
    lanPairingUrl ? status.pairingExpiresAt : null,
  ].filter((value): value is number => Boolean(value))
  const pairingExpiresAt = pairingExpiries.length ? Math.min(...pairingExpiries) : status.pairingExpiresAt
  if (!status.running || (!relayPairingDeepLink && !lanPairingUrl && !primaryPairingUrl) || !pairingExpiresAt) {
    await fs.rm(getMobileHandoffPath(), { force: true }).catch(() => undefined)
    return
  }

  const deepLink = createConnectionOptionsDeepLink({
    relayDeepLink: relayPairingDeepLink,
    lanUrl: lanPairingUrl,
    fallbackUrl: primaryPairingUrl,
  })
  const document = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    pairingExpiresAt: new Date(pairingExpiresAt).toISOString(),
    bridge: {
      host: status.host,
      port: status.port,
    },
    relay: {
      enabled: status.cloudRelay.enabled,
      state: status.cloudRelay.state,
      baseUrl: status.cloudRelay.baseUrl,
      desktopID: status.cloudRelay.desktopID,
    },
    android: {
      pairingUrl: relayPairingDeepLink ?? lanPairingUrl ?? primaryPairingUrl,
      deepLink,
      smokeCommand: `corepack pnpm mobile:android:smoke:bridge -- --url ${quotePowerShellArgument(deepLink)}`,
      handoffCommand: `corepack pnpm mobile:android:handoff-check -- --real-bridge-url ${quotePowerShellArgument(deepLink)}`,
    },
  }

  try {
    const handoffPath = getMobileHandoffPath()
    await fs.mkdir(path.dirname(handoffPath), { recursive: true })
    await fs.writeFile(handoffPath, `${JSON.stringify(document, null, 2)}\n`, "utf8")
  } catch (error) {
    safeError("[desktop][mobile-bridge] failed to write mobile handoff file", error)
  }
}

export async function getMobileBridgeStatus(): Promise<MobileBridgeStatus> {
  const port = bridgePort
  ensureMobileBridgeTunnelRunning(port)
  ensureDesktopCloudRelayClientRunning({
    baseUrl: port ? readBridgePublicBaseUrl() : null,
    desktopName: getDesktopDeviceName(),
    appVersion: app.getVersion(),
    capabilities: DEFAULT_MOBILE_DEVICE_CAPABILITIES,
    getBridgeToken: () => bridgeToken,
    getLocalBridgeBaseUrl: () => (bridgePort ? `http://127.0.0.1:${bridgePort}` : null),
    getAccountSession: getAnyboxProviderRelaySession,
  })
  const pairingCode = port ? getCurrentPairingCode() : null
  const publicBaseUrl = port ? readBridgePublicBaseUrl() : null
  const publicUrl = publicBaseUrl ? publicUrlWithToken(publicBaseUrl) : null
  const localUrl = port ? urlWithToken("127.0.0.1", port) : null
  const urls = port ? listLanHosts().map((host) => urlWithToken(host, port)) : []
  const publicPairingUrl = publicBaseUrl && pairingCode ? publicUrlWithPairingCode(publicBaseUrl, pairingCode.code) : null
  const pairingLocalUrl = port && pairingCode ? urlWithPairingCode("127.0.0.1", port, pairingCode.code) : null
  const pairingUrls = port && pairingCode ? listLanHosts().map((host) => urlWithPairingCode(host, port, pairingCode.code)) : []
  let cloudRelay = getDesktopCloudRelayStatus()
  if (shouldRefreshRelayPairing(cloudRelay)) {
    cloudRelay = await refreshDesktopCloudRelayPairing().catch((error) => {
      safeWarn("[desktop][mobile-relay] failed to refresh expired pairing code", error)
      return getDesktopCloudRelayStatus()
    })
  }
  const status = {
    running: Boolean(server),
    host: bridgeHost,
    port,
    token: bridgeToken,
    publicUrl,
    localUrl,
    urls,
    publicPairingUrl,
    pairingLocalUrl,
    pairingUrls,
    pairingExpiresAt: pairingCode?.expiresAt ?? null,
    startedAt,
    devices: await listMobileDeviceSummaries(),
    cloudRelay,
  }
  await writeMobileHandoffFile(status)
  return status
}

export async function rotateMobileBridgeToken() {
  bridgeToken = createBridgeToken()
  mobilePairingCode = null
  return getMobileBridgeStatus()
}

export async function refreshMobilePairingCode() {
  mobilePairingCode = null
  await refreshDesktopCloudRelayPairing().catch((error) => {
    safeWarn("[desktop][mobile-relay] failed to refresh pairing code", error)
  })
  return getMobileBridgeStatus()
}

export async function revokeMobileDevice(deviceID: string) {
  const document = await readMobileDevicesDocument()
  const device = document.devices.find((candidate) => candidate.id === deviceID)
  if (!device) return getMobileBridgeStatus()
  device.revokedAt = Date.now()
  await writeMobileDevicesDocument(document)
  return getMobileBridgeStatus()
}

async function listenWithFallback(nextServer: http.Server, host: string, preferredPort: number) {
  try {
    return await listen(nextServer, host, preferredPort)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error
    return listen(nextServer, host, 0)
  }
}

function listen(nextServer: http.Server, host: string, port: number) {
  return new Promise<number>((resolve, reject) => {
    const onError = (error: Error) => {
      nextServer.off("listening", onListening)
      reject(error)
    }
    const onListening = () => {
      nextServer.off("error", onError)
      const address = nextServer.address()
      resolve(typeof address === "object" && address ? address.port : port)
    }
    nextServer.once("error", onError)
    nextServer.once("listening", onListening)
    nextServer.listen(port, host)
  })
}

export async function ensureMobileBridgeServerRunning() {
  if (server) return getMobileBridgeStatus()

  bridgeHost = readBridgeHost()
  const nextServer = http.createServer((request, response) => {
    void handleMobileBridgeRequest(request, response).catch((error) => {
      safeError("[desktop][mobile-bridge] request failed", error)
      if (!response.headersSent) {
        jsonResponse(response, 502, errorBody("BRIDGE_REQUEST_FAILED", "Mobile bridge request failed."))
      } else {
        response.end()
      }
    })
  })

  bridgePort = await listenWithFallback(nextServer, bridgeHost, readBridgePort())
  server = nextServer
  startedAt = Date.now()
  const status = await getMobileBridgeStatus()
  safeLog("[desktop][mobile-bridge] ready", {
    ...status,
    token: "[redacted]",
    publicUrl: status.publicUrl ? "[redacted]" : null,
    localUrl: status.localUrl ? "[redacted]" : null,
    urls: status.urls.map(() => "[redacted]"),
    publicPairingUrl: status.publicPairingUrl ? "[redacted]" : null,
    pairingLocalUrl: status.pairingLocalUrl ? "[redacted]" : null,
    pairingUrls: status.pairingUrls.map(() => "[redacted]"),
    cloudRelay: {
      ...status.cloudRelay,
      pairingCode: status.cloudRelay.pairingCode ? "[redacted]" : null,
      pairingDeepLink: status.cloudRelay.pairingDeepLink ? "[redacted]" : null,
    },
  })
  return getMobileBridgeStatus()
}

export async function stopMobileBridgeServer() {
  const current = server
  server = undefined
  bridgePort = null
  startedAt = null
  stopMobileBridgeTunnel()
  stopDesktopCloudRelayClient()
  if (!current) return

  await new Promise<void>((resolve) => {
    current.close(() => resolve())
  })
}

async function handleMobileBridgeRequest(request: http.IncomingMessage, response: http.ServerResponse) {
  writeMobileCorsHeaders(request, response)

  if (!isAllowedMobileBridgeOrigin(request)) {
    safeWarn("[desktop][mobile-bridge] blocked cross-origin request", {
      origin: requestOrigin(request),
      host: request.headers.host,
      path: request.url,
    })
    jsonResponse(response, 403, errorBody("FORBIDDEN_ORIGIN", "Mobile bridge only accepts same-origin requests."))
    return
  }

  if (request.method === "OPTIONS") {
    response.writeHead(204)
    response.end()
    return
  }

  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`)
  if (url.pathname === "/" || url.pathname === "/index.html") {
    textResponse(response, 200, mobileAppHtml(), "text/html; charset=utf-8")
    return
  }

  if (url.pathname === "/api/mobile/status") {
    jsonResponse(response, 200, ok(publicStatus()))
    return
  }

  if (url.pathname === "/api/mobile/pair/preview" && request.method === "GET") {
    const now = Date.now()
    const pairing = inspectPairingCode(url.searchParams.get(PAIRING_CODE_QUERY_PARAM)?.trim() || undefined, now)
    jsonResponse(response, 200, ok({
      ...publicStatus(),
      pairing: {
        valid: pairing.valid,
        expiresAt: pairing.expiresAt,
        serverTime: now,
      },
    }))
    return
  }

  if (url.pathname === "/api/mobile/pair" && request.method === "POST") {
    const code = url.searchParams.get(PAIRING_CODE_QUERY_PARAM)?.trim()
    if (!tokenMatches(readRequestToken(request, url)) && !consumePairingCode(code)) {
      jsonResponse(response, 401, errorBody("UNAUTHORIZED", "Mobile bridge token or pairing code is invalid."))
      return
    }
    const pairResult = await pairMobileDevice(request)
    auditMobileDevicePaired(pairResult.device)
    jsonResponse(response, 200, ok(pairResult))
    return
  }

  const authorization = await authorizeMobileRequest(request, url)
  if (!authorization) {
    jsonResponse(response, 401, errorBody("UNAUTHORIZED", "Mobile bridge token is invalid."))
    return
  }
  const mobileMethod = (request.method ?? "GET").toUpperCase()

  if (url.pathname === "/api/mobile/devices/me/revoke" && request.method === "POST") {
    if (authorization.kind !== "device-token") {
      jsonResponse(response, 400, errorBody("DEVICE_TOKEN_REQUIRED", "Only paired device tokens can be revoked here."))
      return
    }
    const document = await readMobileDevicesDocument()
    const device = document.devices.find((candidate) => candidate.id === authorization.device.id)
    if (device) {
      device.revokedAt = Date.now()
      await writeMobileDevicesDocument(document)
    }
    auditMobileBridgeAction(authorization, "device.revoke", { deviceID: authorization.device.id })
    jsonResponse(response, 200, ok({ deviceID: authorization.device.id, revoked: true }))
    return
  }

  if (url.pathname === "/api/mobile/workspaces" && request.method === "GET") {
    if (!requireMobileCapabilities(authorization, response, ["workspace:read"])) return
    auditMobileBridgeAction(authorization, "workspaces.read")
    jsonResponse(response, 200, ok(await listMobileFolderWorkspaces()))
    return
  }

  if (url.pathname === "/api/mobile/events/stream" && request.method === "GET") {
    if (!requireMobileCapabilities(authorization, response, ["workspace:read", "approval:read"])) return
    auditMobileBridgeAction(authorization, "events.open")
    await streamMobileEvents(request, response, url)
    return
  }

  if (url.pathname === "/api/mobile/approvals" && request.method === "GET") {
    if (!requireMobileCapabilities(authorization, response, ["approval:read"])) return
    auditMobileBridgeAction(authorization, "approvals.read", {
      sessionID: url.searchParams.get("sessionID")?.trim() || undefined,
      status: url.searchParams.get("status")?.trim() || "pending",
    })
    jsonResponse(response, 200, ok(await listMobileApprovals(url)))
    return
  }

  const workspaceSessionsWorkspaceID = mobileWorkspaceSessionsRoute(url)
  if (workspaceSessionsWorkspaceID && (mobileMethod === "GET" || mobileMethod === "POST")) {
    if (!requireMobileCapabilities(authorization, response, [mobileMethod === "POST" ? "session:create" : "session:read"])) return
    auditMobileBridgeAction(authorization, mobileMethod === "POST" ? "session.create" : "sessions.read", {
      workspaceID: workspaceSessionsWorkspaceID,
    })

    if (mobileMethod === "POST") {
      const session = await createMobileWorkspaceSession(workspaceSessionsWorkspaceID, request)
      if (!session) {
        jsonResponse(response, 404, errorBody("WORKSPACE_NOT_FOUND", "Mobile workspace not found."))
        return
      }
      broadcastMobileBridgeDesktopEvent({
        type: "session.created",
        workspaceID: workspaceSessionsWorkspaceID,
        directory: session.directory || workspaceSessionsWorkspaceID,
        sessionID: session.id,
      })
      jsonResponse(response, 200, ok(session))
      return
    }

    const sessions = await listMobileWorkspaceSessions(workspaceSessionsWorkspaceID)
    if (!sessions) {
      jsonResponse(response, 404, errorBody("WORKSPACE_NOT_FOUND", "Mobile workspace not found."))
      return
    }
    jsonResponse(response, 200, ok(sessions))
    return
  }

  const workspaceDiffWorkspaceID = mobileWorkspaceDiffRoute(url)
  if (workspaceDiffWorkspaceID && mobileMethod === "GET") {
    if (!requireMobileCapabilities(authorization, response, ["workspace-file:read"])) return
    auditMobileBridgeAction(authorization, "workspace.diff.read", { workspaceID: workspaceDiffWorkspaceID })
    const data = await getMobileWorkspaceDiff(workspaceDiffWorkspaceID)
    if (data === undefined) {
      jsonResponse(response, 404, errorBody("WORKSPACE_NOT_FOUND", "Mobile workspace not found."))
      return
    }
    jsonResponse(response, 200, ok(data))
    return
  }

  if (request.method === "GET") {
    const workspaceFilesAgentPath = mobileWorkspaceFilesAgentPath(url)
    if (workspaceFilesAgentPath) {
      if (!requireMobileCapabilities(authorization, response, ["workspace-file:read"])) return
      const auditDetails = mobileWorkspaceFilesAuditDetails(url)
      auditMobileBridgeAction(authorization, auditDetails.action, {
        workspaceID: auditDetails.workspaceID,
        path: auditDetails.path,
        query: auditDetails.query,
      })
      await proxyAgentRequest(request, response, workspaceFilesAgentPath)
      return
    }
  }

  const approvalMatch = url.pathname.match(/^\/api\/mobile\/approvals\/([^/]+)\/(approve|deny)$/)
  if (approvalMatch && request.method === "POST") {
    const [, requestID, action] = approvalMatch
    if (!requestID || (action !== "approve" && action !== "deny")) {
      jsonResponse(response, 404, errorBody("NOT_FOUND", "Mobile approval route not found."))
      return
    }
    if (!requireMobileCapabilities(authorization, response, ["approval:respond"])) return
    auditMobileBridgeAction(authorization, "approval.respond", { requestID, decision: action })
    const result = await resolveMobileApproval(requestID, action === "approve" ? "allow" : "deny", request)
    const resultRecord = readRecord(result)
    const requestRecord = readRecord(resultRecord?.request)
    const sessionID = typeof requestRecord?.sessionID === "string" ? requestRecord.sessionID : undefined
    broadcastMobileBridgeDesktopEvent({
      type: "approval.updated",
      approvalID: requestID,
      sessionID,
    })
    jsonResponse(response, 200, ok(result))
    return
  }

  const agentPath = mobileAgentPath(url)
  if (!agentPath) {
    jsonResponse(response, 404, errorBody("NOT_FOUND", "Mobile bridge route not found."))
    return
  }

  const agentCapability = mobileAgentRouteCapability(url, mobileMethod)
  if (!agentCapability) {
    jsonResponse(response, 404, errorBody("NOT_FOUND", "Mobile bridge route not found."))
    return
  }
  if (!requireMobileCapabilities(authorization, response, [agentCapability])) return

  const { action: auditAction, ...auditDetails } = mobileAgentRouteAudit(url, mobileMethod)
  auditMobileBridgeAction(authorization, auditAction, auditDetails)
  const desktopEvent = mobileAgentRouteDesktopEvent(url, mobileMethod)
  if (desktopEvent) broadcastMobileBridgeDesktopEvent(desktopEvent)
  await proxyAgentRequest(request, response, agentPath)
  if (desktopEvent) broadcastMobileBridgeDesktopEvent(desktopEvent)
}

function mobileAppHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>Anybox Mobile</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #050506; color: #f6f7f8; }
    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    body { margin: 0; min-height: 100dvh; background: #050506; }
    button, input, textarea { font: inherit; }
    button { border: 0; border-radius: 12px; background: #f6f7f8; color: #050506; min-height: 42px; padding: 0 14px; font-weight: 700; cursor: pointer; }
    button:disabled { cursor: default; opacity: 0.62; }
    button.secondary { background: #232428; color: #f6f7f8; }
    button.ghost { background: transparent; color: #f6f7f8; border: 1px solid #2f3137; }
    input, textarea { width: 100%; border: 1px solid #2f3137; border-radius: 14px; background: #17181c; color: #f6f7f8; padding: 12px 14px; outline: none; }
    textarea { min-height: 52px; max-height: 160px; resize: vertical; }
    .app { min-height: 100dvh; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; }
    header { position: sticky; top: 0; z-index: 2; display: grid; gap: 8px; padding: calc(env(safe-area-inset-top) + 16px) 18px 14px; background: rgba(5, 5, 6, 0.92); backdrop-filter: blur(14px); border-bottom: 1px solid #17181c; }
    header h1 { margin: 0; text-align: center; font-size: 20px; line-height: 1.2; letter-spacing: 0; }
    .status { display: flex; align-items: center; gap: 8px; color: #a9adb6; font-size: 13px; }
    .dot { width: 8px; height: 8px; border-radius: 999px; background: #39d078; }
    main { min-height: 0; overflow: auto; padding: 16px 18px 28px; }
    .stack { width: min(100%, 760px); margin: 0 auto; display: grid; gap: 24px; }
    .section { display: grid; gap: 10px; }
    .section-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
    .section h2 { margin: 0; font-size: 13px; line-height: 1.2; color: #a9adb6; font-weight: 650; letter-spacing: 0; text-transform: uppercase; }
    .section-count { color: #707782; font-size: 12px; white-space: nowrap; }
    .list { display: grid; border-top: 1px solid #17181c; }
    .row { width: 100%; min-height: 68px; border: 0; border-bottom: 1px solid #17181c; border-radius: 0; padding: 12px 0; background: transparent; color: #f6f7f8; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px 14px; text-align: left; }
    .row-main { min-width: 0; display: grid; gap: 5px; }
    .row strong, .row-detail { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .row strong { font-size: 17px; font-weight: 620; line-height: 1.2; }
    .row-detail, .muted { color: #a9adb6; font-size: 12px; line-height: 1.35; }
    .row-meta { align-self: start; border: 1px solid #252830; border-radius: 999px; padding: 3px 8px; color: #c8ccd4; font-size: 12px; white-space: nowrap; }
    .row.is-missing strong, .row.is-missing .row-detail { color: #707782; }
    .workspace-view { min-height: 100dvh; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; }
    .detail-header { position: sticky; top: 0; z-index: 2; display: grid; gap: 8px; padding: calc(env(safe-area-inset-top) + 12px) 18px 14px; background: rgba(5, 5, 6, 0.94); backdrop-filter: blur(14px); border-bottom: 1px solid #17181c; }
    .detail-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .detail-header h1 { margin: 0; font-size: 22px; line-height: 1.2; letter-spacing: 0; }
    .detail-path { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .workspace-actions { padding: 12px 18px calc(env(safe-area-inset-bottom) + 12px); background: rgba(5, 5, 6, 0.96); border-top: 1px solid #17181c; }
    .workspace-actions button { width: min(100%, 760px); margin: 0 auto; display: block; }
    .chat { min-height: 0; display: none; grid-template-rows: auto minmax(0, 1fr) auto; height: 100dvh; }
    .chat.is-active { display: grid; }
    .chat-title { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: calc(env(safe-area-inset-top) + 12px) 12px 12px; border-bottom: 1px solid #17181c; }
    .chat-title h2 { min-width: 0; margin: 0; font-size: 18px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .messages { min-height: 0; overflow: auto; display: grid; align-content: start; gap: 12px; padding: 14px; }
    .message { max-width: 92%; display: grid; gap: 6px; padding: 11px 12px; border-radius: 14px; background: #17181c; color: #f6f7f8; white-space: pre-wrap; overflow-wrap: anywhere; }
    .message.user { justify-self: end; background: #f6f7f8; color: #050506; }
    .message small { color: #8d929c; font-size: 11px; text-transform: uppercase; letter-spacing: 0; }
    .composer { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; padding: 12px 12px calc(env(safe-area-inset-bottom) + 12px); border-top: 1px solid #17181c; }
    .setup { min-height: 100dvh; display: grid; place-items: center; padding: 24px; }
    .setup-card { width: min(100%, 420px); display: grid; gap: 14px; }
    .setup-card h1 { margin: 0; font-size: 24px; }
    .error { color: #ff8c8c; }
  </style>
</head>
<body>
  <div id="setup" class="setup" hidden>
    <form id="setup-form" class="setup-card">
      <h1>Anybox Mobile</h1>
      <p class="muted">Enter the mobile bridge token from the desktop app.</p>
      <input id="token-input" autocomplete="one-time-code" placeholder="Token">
      <button id="connect-button" type="submit">Connect</button>
      <p id="setup-error" class="error"></p>
    </form>
  </div>

  <div id="home" class="app" hidden>
    <header>
      <h1>Anybox</h1>
      <div class="status"><span class="dot"></span><span id="host-label">Desktop connected</span></div>
    </header>
    <main>
      <div class="stack">
        <section class="section">
          <div class="section-heading">
            <h2>Workspaces</h2>
            <span id="workspace-count" class="section-count"></span>
          </div>
          <div id="workspaces" class="list"></div>
        </section>
        <section class="section">
          <div class="section-heading">
            <h2>Recent Sessions</h2>
            <span id="recent-count" class="section-count"></span>
          </div>
          <div id="recent" class="list"></div>
        </section>
      </div>
    </main>
  </div>

  <div id="workspace-view" class="workspace-view" hidden>
    <header class="detail-header">
      <div class="detail-top">
        <button id="workspace-back-button" class="ghost" type="button">Back</button>
        <span id="workspace-chat-count" class="section-count"></span>
      </div>
      <h1 id="workspace-title"></h1>
      <p id="workspace-path" class="detail-path muted"></p>
    </header>
    <main>
      <div class="stack">
        <section class="section">
          <div class="section-heading">
            <h2>Chats</h2>
          </div>
          <div id="workspace-sessions" class="list"></div>
        </section>
      </div>
    </main>
    <div class="workspace-actions">
      <button id="new-chat-button" type="button">New chat</button>
    </div>
  </div>

  <div id="chat" class="chat">
    <div class="chat-title">
      <button id="back-button" class="ghost" type="button">Back</button>
      <h2 id="chat-heading"></h2>
      <button id="refresh-button" class="ghost" type="button">Refresh</button>
    </div>
    <div id="messages" class="messages"></div>
    <form id="composer" class="composer">
      <textarea id="prompt" placeholder="Message"></textarea>
      <button type="submit">Send</button>
    </form>
  </div>

  <script>
    const setup = document.getElementById("setup");
    const home = document.getElementById("home");
    const workspaceView = document.getElementById("workspace-view");
    const chat = document.getElementById("chat");
    const workspacesEl = document.getElementById("workspaces");
    const recentEl = document.getElementById("recent");
    const workspaceSessionsEl = document.getElementById("workspace-sessions");
    const workspaceCountEl = document.getElementById("workspace-count");
    const recentCountEl = document.getElementById("recent-count");
    const workspaceChatCountEl = document.getElementById("workspace-chat-count");
    const workspaceTitleEl = document.getElementById("workspace-title");
    const workspacePathEl = document.getElementById("workspace-path");
    const messagesEl = document.getElementById("messages");
    const headingEl = document.getElementById("chat-heading");
    const setupForm = document.getElementById("setup-form");
    const tokenInput = document.getElementById("token-input");
    const setupError = document.getElementById("setup-error");
    const connectButton = document.getElementById("connect-button");
    const newChatButton = document.getElementById("new-chat-button");
    const promptEl = document.getElementById("prompt");
    const state = { token: "", workspaces: [], sessions: [], activeWorkspace: null, activeSession: null };
    const requestTimeoutMs = 12000;

    const initialToken = new URLSearchParams(location.search).get("token") || localStorage.getItem("anybox.mobile.token") || "";
    if (initialToken) {
      showSetup();
      tokenInput.value = initialToken;
      connectWithToken(initialToken);
    } else {
      showSetup();
    }

    async function handleSetupConnect(event) {
      event.preventDefault();
      if (connectButton.disabled) return;
      const token = tokenInput.value.trim();
      if (!token) {
        setupError.textContent = "Paste the token first.";
        return;
      }
      await connectWithToken(token);
    }

    setupForm.addEventListener("submit", handleSetupConnect);
    connectButton.addEventListener("click", handleSetupConnect);

    document.getElementById("workspace-back-button").addEventListener("click", () => showHome());
    newChatButton.addEventListener("click", () => {
      if (state.activeWorkspace) void createWorkspaceSession(state.activeWorkspace);
    });
    document.getElementById("back-button").addEventListener("click", () => {
      if (state.activeWorkspace) {
        showWorkspace(state.activeWorkspace);
      } else {
        showHome();
      }
    });
    document.getElementById("refresh-button").addEventListener("click", () => {
      if (state.activeSession) loadMessages(state.activeSession);
    });
    document.getElementById("composer").addEventListener("submit", async (event) => {
      event.preventDefault();
      const text = promptEl.value.trim();
      if (!text || !state.activeSession) return;
      promptEl.value = "";
      renderMessage({ role: "user", text });
      renderMessage({ role: "assistant", text: "Working..." });
      await streamTurn(state.activeSession.id, text);
      await loadMessages(state.activeSession);
    });

    function showSetup() {
      setup.hidden = false;
      home.hidden = true;
      workspaceView.hidden = true;
      chat.classList.remove("is-active");
    }

    function showHome() {
      state.activeWorkspace = null;
      setup.hidden = true;
      home.hidden = false;
      workspaceView.hidden = true;
      chat.classList.remove("is-active");
    }

    function setConnecting(value) {
      connectButton.disabled = value;
      connectButton.textContent = value ? "Connecting..." : "Connect";
    }

    async function connectWithToken(token) {
      state.token = token;
      tokenInput.value = token;
      setupError.textContent = "";
      localStorage.setItem("anybox.mobile.token", token);
      setConnecting(true);
      setupError.textContent = "Connecting to desktop...";
      try {
        await loadHome();
        setupError.textContent = "";
        showHome();
      } catch (error) {
        setupError.textContent = error instanceof Error ? error.message : String(error);
        showSetup();
      } finally {
        setConnecting(false);
      }
    }

    function showChat(session) {
      state.activeSession = session;
      state.activeWorkspace = session.workspace || state.activeWorkspace;
      setup.hidden = true;
      home.hidden = true;
      workspaceView.hidden = true;
      chat.classList.add("is-active");
      headingEl.textContent = session.title || session.id;
      loadMessages(session);
    }

    function showWorkspace(workspace) {
      state.activeWorkspace = workspace;
      renderWorkspaceSessions(workspace);
      setup.hidden = true;
      home.hidden = true;
      workspaceView.hidden = false;
      chat.classList.remove("is-active");
    }

    async function api(path, options = {}) {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), requestTimeoutMs);
      const response = await fetch(path, {
        ...options,
        signal: options.signal || controller.signal,
        headers: {
          "authorization": "Bearer " + state.token,
          "content-type": "application/json",
          ...(options.headers || {}),
        },
      }).catch((error) => {
        if (error && error.name === "AbortError") {
          throw new Error("Request timed out. Check that the desktop agent is running, then try again.");
        }
        throw error;
      }).finally(() => window.clearTimeout(timeout));
      const data = await response.json().catch(() => null);
      if (!response.ok || !data || data.success !== true) {
        const message = data && data.error ? data.error.message : "Request failed";
        if (response.status === 401) {
          localStorage.removeItem("anybox.mobile.token");
          state.token = "";
          setupError.textContent = message + " Refresh the token in the desktop app and paste the latest value.";
          showSetup();
        }
        throw new Error(message);
      }
      return data.data;
    }

    async function loadHome() {
      const workspaces = await api("/api/mobile/workspaces");
      state.workspaces = Array.isArray(workspaces) ? workspaces : [];
      state.sessions = state.workspaces
        .flatMap((workspace) => (workspace.sessions || []).map((session) => decorateSession(session, workspace)))
        .sort((a, b) => readUpdated(b) - readUpdated(a));
      renderWorkspaces();
      renderRecent();
    }

    function decorateSession(session, workspace) {
      return {
        ...session,
        workspace,
        project: workspace.project,
        projectID: session.projectID || workspace.project.id,
        directory: session.directory || workspace.directory,
        created: session.created || (session.time && session.time.created) || workspace.created,
        updated: readUpdated(session) || workspace.updated,
      };
    }

    function renderWorkspaces() {
      workspaceCountEl.textContent = state.workspaces.length ? state.workspaces.length + " workspaces" : "";
      workspacesEl.replaceChildren(...state.workspaces.map((workspace) => {
        const sessionCount = Array.isArray(workspace.sessions) ? workspace.sessions.length : 0;
        const meta = sessionCount === 1 ? "1 chat" : sessionCount + " chats";
        const item = row(workspace.name || basename(workspace.directory), workspace.directory, meta, () => showWorkspace(workspace));
        if (workspace.exists === false) item.classList.add("is-missing");
        return item;
      }));
      if (state.workspaces.length === 0) workspacesEl.replaceChildren(emptyRow("No workspaces with sessions"));
    }

    function renderWorkspaceSessions(workspace) {
      const sessions = (workspace.sessions || [])
        .map((session) => decorateSession(session, workspace))
        .sort((a, b) => readUpdated(b) - readUpdated(a));
      workspaceTitleEl.textContent = workspace.name || basename(workspace.directory);
      workspacePathEl.textContent = workspace.directory;
      workspaceChatCountEl.textContent = sessions.length === 1 ? "1 chat" : sessions.length + " chats";
      workspaceSessionsEl.replaceChildren(...sessions.map((session) => (
        row(session.title || "New chat", session.directory, formatRelative(readUpdated(session)), () => showChat(session))
      )));
      if (sessions.length === 0) workspaceSessionsEl.replaceChildren(emptyRow("No chats yet"));
    }

    async function createWorkspaceSession(workspace) {
      newChatButton.disabled = true;
      newChatButton.textContent = "Creating...";
      try {
        const created = await api("/api/mobile/workspaces/" + encodeURIComponent(workspace.id) + "/sessions", {
          method: "POST",
          body: JSON.stringify({ title: "Mobile chat" }),
        });
        const session = decorateSession(created, workspace);
        workspace.sessions = [session, ...(workspace.sessions || [])];
        state.sessions = [session, ...state.sessions.filter((item) => item.id !== session.id)].sort((a, b) => readUpdated(b) - readUpdated(a));
        renderWorkspaces();
        renderRecent();
        showChat(session);
      } finally {
        newChatButton.disabled = false;
        newChatButton.textContent = "New chat";
      }
    }

    function renderRecent() {
      recentCountEl.textContent = state.sessions.length ? state.sessions.length + " sessions" : "";
      recentEl.replaceChildren(...state.sessions.slice(0, 20).map((session) => {
        const title = session.title || "New chat";
        const workspaceName = session.workspace ? session.workspace.name : basename(session.directory);
        const detail = workspaceName ? workspaceName + " - " + session.directory : session.directory;
        return row(title, detail, formatRelative(readUpdated(session)), () => showChat(session));
      }));
      if (state.sessions.length === 0) recentEl.replaceChildren(emptyRow("No recent sessions"));
    }

    function row(title, detail, meta, onClick) {
      const button = document.createElement("button");
      button.className = "row";
      button.type = "button";
      const main = document.createElement("span");
      main.className = "row-main";
      const strong = document.createElement("strong");
      strong.textContent = title;
      const detailEl = document.createElement("span");
      detailEl.className = "row-detail";
      detailEl.textContent = detail;
      const metaEl = document.createElement("span");
      metaEl.className = "row-meta";
      metaEl.textContent = meta;
      main.append(strong, detailEl);
      button.append(main, metaEl);
      button.addEventListener("click", onClick);
      return button;
    }

    function emptyRow(text) {
      const div = document.createElement("div");
      div.className = "row muted";
      div.textContent = text;
      return div;
    }

    async function loadMessages(session) {
      messagesEl.replaceChildren();
      const messages = await api("/api/mobile/sessions/" + encodeURIComponent(session.id) + "/messages?view=active");
      for (const message of messages || []) {
        renderMessage({
          role: message.info && message.info.role ? message.info.role : "assistant",
          text: extractText(message.parts) || JSON.stringify(message.parts || "", null, 2),
        });
      }
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function renderMessage(message) {
      const div = document.createElement("div");
      div.className = "message " + (message.role === "user" ? "user" : "assistant");
      const role = document.createElement("small");
      role.textContent = message.role;
      const body = document.createElement("div");
      body.textContent = message.text || "";
      div.append(role, body);
      messagesEl.append(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return div;
    }

    async function streamTurn(sessionID, text) {
      const response = await fetch("/api/mobile/sessions/" + encodeURIComponent(sessionID) + "/messages/stream", {
        method: "POST",
        headers: {
          "authorization": "Bearer " + state.token,
          "content-type": "application/json",
        },
        body: JSON.stringify({ text }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data && data.error ? data.error.message : "Stream failed");
      }
      if (!response.body) return;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const parts = buffer.split(/\\r?\\n\\r?\\n/);
        buffer = parts.pop() || "";
      }
    }

    function extractText(value) {
      if (typeof value === "string") return value;
      if (Array.isArray(value)) return value.map(extractText).filter(Boolean).join("\\n");
      if (!value || typeof value !== "object") return "";
      if (typeof value.text === "string") return value.text;
      if (typeof value.content === "string") return value.content;
      if (typeof value.value === "string") return value.value;
      if (Array.isArray(value.parts)) return extractText(value.parts);
      return "";
    }

    function readUpdated(session) {
      return session.updated || (session.time && session.time.updated) || 0;
    }

    function basename(path) {
      return String(path || "").split(/[\\\\/]/).filter(Boolean).pop() || "";
    }

    function formatRelative(value) {
      if (!value) return "";
      const diff = Math.max(0, Date.now() - value);
      const minute = 60 * 1000;
      if (diff < minute) return "now";
      if (diff < 60 * minute) return Math.floor(diff / minute) + "m";
      if (diff < 24 * 60 * minute) return Math.floor(diff / (60 * minute)) + "h";
      return Math.floor(diff / (24 * 60 * minute)) + "d";
    }
  </script>
</body>
</html>`
}
