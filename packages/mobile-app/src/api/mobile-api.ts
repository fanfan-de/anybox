export interface MobileConnection {
  baseUrl: string
  token: string
  transport?: "bridge" | "relay"
  desktopID?: string
  deviceID?: string
}

export type MobileDesktopPlatform = "windows" | "macos" | "linux" | "unknown"

export interface MobileStatus {
  service: string
  running: boolean
  desktopName?: string
  appVersion?: string
  platform?: MobileDesktopPlatform
  platformVersion?: string
  arch?: string
  online?: boolean
  capabilities?: string[]
}

export interface MobileProjectSummary {
  id: string
  name: string
  repositoryRoot?: string
  workspaceRoots?: string[]
  worktree: string
  kind?: "directory" | "git"
  vcs?: "git"
}

export interface MobileSessionSummary {
  id: string
  projectID: string
  worktreeID?: string
  directory: string
  title: string
  pinned?: boolean
  kind?: string
  created: number
  updated: number
  workflow?: {
    agent: string
    status: "running" | "completed" | "blocked" | "stopped" | "failed" | "cancelled"
    active: boolean
    updatedAt: number
  }
}

export interface MobileWorkspace {
  id: string
  directory: string
  name: string
  exists: boolean
  created: number
  updated: number
  project: MobileProjectSummary
  sessions: MobileSessionSummary[]
}

export interface MobileMessage {
  info?: {
    id?: string
    internal?: boolean
    pending?: boolean
    role?: "user" | "assistant" | "system" | "tool" | string
    created?: number
    updated?: number
  }
  parts?: unknown[]
}

export type MobileSessionTaskStatus = "pending" | "in_progress" | "completed"

export interface MobileSessionTaskPeer {
  id: string
  subject: string
  status: MobileSessionTaskStatus
  owner: string
}

export interface MobileSessionTaskSummary {
  id: string
  sessionID: string
  subject: string
  description: string
  activeForm: string
  owner: string
  status: MobileSessionTaskStatus
  sortIndex: number
  blocks: string[]
  blockedBy: string[]
  metadata: Record<string, unknown>
  createdAt: number
  updatedAt: number
  startedAt?: number
  completedAt?: number
  sourceAssistantMessageID?: string
  sourceUserMessageID?: string
  toolCallID?: string
  isBlocked: boolean
  blockingTasks: MobileSessionTaskPeer[]
  blockedTasks: MobileSessionTaskPeer[]
}

export interface MobileSessionTaskListView {
  sessionID: string
  generatedAt: number
  tasks: MobileSessionTaskSummary[]
  current: MobileSessionTaskSummary[]
  next: MobileSessionTaskSummary[]
  blocked: MobileSessionTaskSummary[]
  summary: {
    total: number
    completed: number
    pending: number
    inProgress: number
    blocked: number
  }
}

export interface MobileWorkspaceFileEntry {
  path: string
  name: string
  kind: "directory" | "file"
  extension: string | null
  hasChildren: boolean
}

export interface MobileWorkspaceFileSearchResult {
  path: string
  absolutePath?: string
  name: string
  extension: string | null
}

export type MobileWorkspaceFileDocument =
  | {
      path: string
      name: string
      extension: string | null
      kind: "text"
      content: string
    }
  | {
      path: string
      name: string
      extension: string | null
      kind: "image"
      mimeType: string
      previewUrl: string
      size: number
    }
  | {
      path: string
      name: string
      extension: string | null
      kind: "unsupported"
      unsupportedReason: string
    }

export interface MobileWorkspaceDiffFile {
  file: string
  additions: number
  deletions: number
  gitState?: "clean" | "mixed" | "staged" | "unknown" | "unstaged" | "untracked"
}

export interface MobileWorkspaceDiffSummary {
  title?: string
  body?: string
  stats?: {
    additions: number
    deletions: number
    files: number
  }
  scope?: string
  diffs: MobileWorkspaceDiffFile[]
}

export interface MobileDevice {
  id: string
  name: string
  createdAt: number
  lastSeenAt: number
  revokedAt?: number
  capabilities: string[]
}

export type MobileApprovalStatus = "pending" | "approved" | "denied" | "expired"
export type MobileApprovalRisk = "low" | "medium" | "high" | "critical"
export type MobileApprovalDecision = "allow" | "deny"

export interface MobileApproval {
  id: string
  approvalID: string
  sessionID: string
  messageID: string
  toolCallID: string
  projectID: string
  agent: string
  status: MobileApprovalStatus
  createdAt: number
  prompt: {
    title: string
    summary: string
    rationale: string
    risk: MobileApprovalRisk
    detailsAvailable: boolean
    details?: {
      paths?: string[]
      command?: string
      workdir?: string
      body?: string
    }
    allowedDecisions: MobileApprovalDecision[]
    recommendedDecision: MobileApprovalDecision
  }
  resolution?: {
    decision: MobileApprovalDecision
    note?: string
    approved: boolean
    resolvedAt: number
  }
}

export interface MobileProviderModel {
  id: string
  providerID: string
  providerName?: string
  name: string
  family?: string
  status: "alpha" | "beta" | "deprecated" | "active"
  available: boolean
  capabilities?: {
    temperature?: boolean
    reasoning?: boolean
    attachment?: boolean
    toolcall?: boolean
    input?: Record<string, boolean | undefined>
    output?: Record<string, boolean | undefined>
  }
  limit?: {
    context: number
    input?: number
    output: number
  }
}

export interface MobileModelSelection {
  model?: string
  small_model?: string
  reasoning_effort?: string
  image_model?: string
}

export interface MobileSessionModelsResult {
  items: MobileProviderModel[]
  selection: MobileModelSelection
  effectiveModel?: MobileProviderModel | null
}

export type MobileEventName =
  | "sync.ready"
  | "sync.updated"
  | "sync.error"
  | "workspace.updated"
  | "session.created"
  | "session.updated"
  | "approval.requested"
  | "approval.updated"

export type MobileEvent =
  | { type: "sync.ready"; generatedAt: number }
  | { type: "sync.updated"; generatedAt: number }
  | { type: "sync.error"; message: string; generatedAt: number }
  | { type: "workspace.updated"; workspace: MobileWorkspace; generatedAt: number }
  | { type: "session.created"; session: MobileSessionSummary; workspaceID: string; generatedAt: number }
  | { type: "session.updated"; session: MobileSessionSummary; workspaceID: string; generatedAt: number }
  | { type: "approval.requested"; approval: MobileApproval; generatedAt: number }
  | { type: "approval.updated"; approval?: MobileApproval; approvalID?: string; status?: string; generatedAt: number }

export interface MobileStreamEvent {
  id?: string
  event: string
  data: unknown
}

export type MobileStreamTextDeltaKind = "text" | "reasoning"

export interface MobileStreamTextDelta {
  kind: MobileStreamTextDeltaKind
  delta: string
  sourceID?: string
}

export interface MobileStreamCallbacks {
  onEvent?: (event: MobileStreamEvent) => void
  onOpen?: () => void
  onTextDelta?: (delta: MobileStreamTextDelta) => void
}

export interface MobilePairResult {
  token: string
  device: MobileDevice
  desktopID?: string
  desktop?: {
    id: string
    name: string
    appVersion?: string
    platform?: MobileDesktopPlatform
    platformVersion?: string
    arch?: string
    online: boolean
    capabilities: string[]
    pairingExpiresAt: number | null
  }
}

export interface MobilePairPreview extends MobileStatus {
  pairing: {
    valid: boolean
    expiresAt: number | null
    serverTime: number
  }
}

export interface NormalizedConnectionInput {
  baseUrl: string
  token: string
  transport?: "bridge" | "relay"
  desktopID?: string
  pairingCode?: string
}

export type MobileConnectionOptionKind = "relay" | "lan" | "bridge"

export interface NormalizedConnectionOption {
  id: string
  kind: MobileConnectionOptionKind
  label: string
  endpoint: string
  connection: NormalizedConnectionInput
}

type Envelope<T> =
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

interface RelayMobileHttpResult {
  status: number
  headers?: Record<string, string>
  body: unknown
  text?: string
}

interface RelayPairResult {
  token: string
  desktop: NonNullable<MobilePairResult["desktop"]>
  device: MobileDevice
}

export class MobileApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message)
    this.name = "MobileApiError"
  }
}

function readAnyboxDeepLinkRoute(value: URL) {
  return value.hostname || value.pathname.replace(/^\/+/, "")
}

function isAnyboxMobileProtocol(protocol: string) {
  return protocol === "anybox-mobile:" || protocol === "anybox-mobile-dev:"
}

export function readBridgeUrlFromConnectDeepLink(value: string) {
  try {
    const parsed = new URL(value.trim())
    const route = readAnyboxDeepLinkRoute(parsed)
    if (!isAnyboxMobileProtocol(parsed.protocol) || route !== "connect") return null
    return parsed.searchParams.get("url")?.trim() || null
  } catch {
    return null
  }
}

export function readRelayPairingFromDeepLink(value: string) {
  try {
    const parsed = new URL(value.trim())
    const route = readAnyboxDeepLinkRoute(parsed)
    if (!isAnyboxMobileProtocol(parsed.protocol) || route !== "pair") return null
    const code = parsed.searchParams.get("code")?.trim() ?? ""
    const baseUrl = parsed.searchParams.get("url")?.trim() || "https://anybox.com.cn"
    return code ? { baseUrl, code } : null
  } catch {
    return null
  }
}

export function readConnectionOptionsFromDeepLink(value: string) {
  try {
    const parsed = new URL(value.trim())
    const route = readAnyboxDeepLinkRoute(parsed)
    if (!isAnyboxMobileProtocol(parsed.protocol) || route !== "connect-options") return null

    const options: Array<{ kind: MobileConnectionOptionKind; endpoint: string }> = []
    const relay = parsed.searchParams.get("relay")?.trim()
    const lan = parsed.searchParams.get("lan")?.trim()
    const bridge = parsed.searchParams.get("bridge")?.trim()

    if (relay) options.push({ kind: "relay", endpoint: relay })
    if (lan) options.push({ kind: "lan", endpoint: lan })
    if (bridge) options.push({ kind: "bridge", endpoint: bridge })
    return options.length ? options : null
  } catch {
    return null
  }
}

export function readConnectionUrlFromDeepLink(value: string) {
  if (readConnectionOptionsFromDeepLink(value)) return value.trim()
  if (readRelayPairingFromDeepLink(value)) return value.trim()
  return readBridgeUrlFromConnectDeepLink(value)
}

function connectionOptionLabel(kind: MobileConnectionOptionKind) {
  if (kind === "relay") return "Cloud relay"
  if (kind === "lan") return "Local network"
  return "Direct bridge"
}

function inferConnectionOptionKind(connection: NormalizedConnectionInput): MobileConnectionOptionKind {
  return connection.transport === "relay" ? "relay" : "bridge"
}

function normalizeConnectionOption(
  id: string,
  kind: MobileConnectionOptionKind | undefined,
  endpoint: string,
  tokenInput: string,
): NormalizedConnectionOption {
  const connection = normalizeConnectionInput(endpoint, tokenInput)
  const nextKind = kind ?? inferConnectionOptionKind(connection)
  return {
    id,
    kind: nextKind,
    label: connectionOptionLabel(nextKind),
    endpoint,
    connection,
  }
}

export function normalizeConnectionOptionsInput(endpoint: string, tokenInput: string): NormalizedConnectionOption[] {
  const optionInputs = readConnectionOptionsFromDeepLink(endpoint)
  if (!optionInputs) {
    const rawEndpoint = readConnectionUrlFromDeepLink(endpoint) ?? endpoint.trim()
    return [normalizeConnectionOption("primary", undefined, rawEndpoint, tokenInput)]
  }

  const seen = new Set<string>()
  const options: NormalizedConnectionOption[] = []
  for (const [index, option] of optionInputs.entries()) {
    if (seen.has(option.endpoint)) continue
    seen.add(option.endpoint)
    try {
      options.push(normalizeConnectionOption(`${option.kind}-${index}`, option.kind, option.endpoint, tokenInput))
    } catch {
      // Ignore a malformed candidate if another candidate in the same QR code is usable.
    }
  }

  if (!options.length) {
    throw new Error("Connection QR code does not contain a usable Anybox connection option.")
  }

  return options
}

export function normalizeConnectionInput(endpoint: string, tokenInput: string): NormalizedConnectionInput {
  const relayPairing = readRelayPairingFromDeepLink(endpoint)
  if (relayPairing) {
    const parsed = new URL(relayPairing.baseUrl)
    const token = tokenInput.trim()
    return {
      baseUrl: parsed.origin,
      token,
      transport: "relay",
      pairingCode: relayPairing.code,
    }
  }

  const rawEndpoint = readBridgeUrlFromConnectDeepLink(endpoint) ?? endpoint.trim()
  if (!rawEndpoint) {
    throw new Error("Bridge URL is required.")
  }

  const candidate = /^[a-z][a-z\d+\-.]*:\/\//i.test(rawEndpoint) ? rawEndpoint : `http://${rawEndpoint}`
  const parsed = new URL(candidate)
  const tokenFromUrl = parsed.searchParams.get("token")?.trim() ?? ""
  const pairingCode = parsed.searchParams.get("code")?.trim() ?? ""
  const token = tokenInput.trim() || tokenFromUrl

  if (!token && !pairingCode) {
    throw new Error("Bridge token or pairing code is required.")
  }

  return {
    baseUrl: parsed.origin,
    token,
    pairingCode: pairingCode || undefined,
  }
}

export async function getStatus(connection: MobileConnection) {
  if (isRelayConnection(connection)) {
    const status = await requestRelay<NonNullable<MobilePairResult["desktop"]>>(
      connection,
      `/api/relay/desktops/${encodeURIComponent(connection.desktopID)}/status`,
    )
    return {
      service: "anybox-cloud-relay",
      running: status.online,
      desktopName: status.name,
      appVersion: status.appVersion,
      platform: status.platform,
      platformVersion: status.platformVersion,
      arch: status.arch,
      online: status.online,
      capabilities: status.capabilities,
    } satisfies MobileStatus
  }
  return requestMobile<MobileStatus>(connection, "/api/mobile/status")
}

export async function getWorkspaces(connection: MobileConnection) {
  return requestMobile<MobileWorkspace[]>(connection, "/api/mobile/workspaces")
}

export async function pairDevice(connection: MobileConnection & { pairingCode?: string }, name: string, input?: { accountToken?: string }) {
  if (connection.transport === "relay") {
    const result = await requestRelay<RelayPairResult>(
      { ...connection, token: "" },
      "/api/relay/pair",
      {
        method: "POST",
        body: JSON.stringify({ code: connection.pairingCode, name }),
        ...(input?.accountToken
          ? {
              headers: {
                authorization: `Bearer ${input.accountToken}`,
              },
            }
          : {}),
      },
    )
    return {
      token: result.token,
      device: result.device,
      desktopID: result.desktop.id,
      desktop: result.desktop,
    } satisfies MobilePairResult
  }

  const params = new URLSearchParams()
  if (connection.pairingCode) params.set("code", connection.pairingCode)
  const query = params.toString()
  return requestMobile<MobilePairResult>(connection, `/api/mobile/pair${query ? `?${query}` : ""}`, {
    method: "POST",
    body: JSON.stringify({ name }),
  })
}

export async function previewPairing(connection: MobileConnection & { pairingCode?: string }, input?: { signal?: AbortSignal }) {
  if (connection.transport === "relay") {
    const params = new URLSearchParams()
    if (connection.pairingCode) params.set("code", connection.pairingCode)
    const query = params.toString()
    return requestRelay<MobilePairPreview>(
      { ...connection, token: "" },
      `/api/relay/pair/preview${query ? `?${query}` : ""}`,
      { signal: input?.signal },
    )
  }

  const params = new URLSearchParams()
  if (connection.pairingCode) params.set("code", connection.pairingCode)
  const query = params.toString()
  return requestMobile<MobilePairPreview>(
    { baseUrl: connection.baseUrl, token: "" },
    `/api/mobile/pair/preview${query ? `?${query}` : ""}`,
    { signal: input?.signal },
  )
}

export async function createSession(
  connection: MobileConnection,
  workspaceID: string,
  input: {
    title: string
  },
) {
  return requestMobile<MobileSessionSummary>(connection, `/api/mobile/workspaces/${encodeURIComponent(workspaceID)}/sessions`, {
    method: "POST",
    body: JSON.stringify(input),
  })
}

export async function renameSession(
  connection: MobileConnection,
  sessionID: string,
  input: {
    title: string
  },
) {
  return requestMobile<MobileSessionSummary>(connection, `/api/mobile/sessions/${encodeURIComponent(sessionID)}/title`, {
    method: "PATCH",
    body: JSON.stringify(input),
  })
}

export async function updateSessionPinned(
  connection: MobileConnection,
  sessionID: string,
  input: {
    pinned: boolean
  },
) {
  return requestMobile<MobileSessionSummary>(connection, `/api/mobile/sessions/${encodeURIComponent(sessionID)}/pinned`, {
    method: "PATCH",
    body: JSON.stringify(input),
  })
}

export async function deleteSession(connection: MobileConnection, sessionID: string) {
  return requestMobile<{ sessionID: string; projectID: string }>(
    connection,
    `/api/mobile/sessions/${encodeURIComponent(sessionID)}`,
    {
      method: "DELETE",
    },
  )
}

export async function getMessages(connection: MobileConnection, sessionID: string) {
  return requestMobile<MobileMessage[]>(
    connection,
    `/api/mobile/sessions/${encodeURIComponent(sessionID)}/messages?view=active`,
  )
}

export async function answerSessionQuestion(
  connection: MobileConnection,
  sessionID: string,
  input: {
    questionID: string
    selectedOptions?: string[]
    freeformText?: string
  },
) {
  return requestMobile<unknown>(
    connection,
    `/api/mobile/sessions/${encodeURIComponent(sessionID)}/questions/answer`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  )
}

export async function getSessionModels(connection: MobileConnection, sessionID: string) {
  return requestMobile<MobileSessionModelsResult>(
    connection,
    `/api/mobile/sessions/${encodeURIComponent(sessionID)}/models`,
  )
}

export async function getWorkspaceModels(connection: MobileConnection, workspaceID: string) {
  return requestMobile<MobileSessionModelsResult>(
    connection,
    `/api/mobile/workspaces/${encodeURIComponent(workspaceID)}/models`,
  )
}

export async function updateSessionModelSelection(
  connection: MobileConnection,
  sessionID: string,
  input: {
    model?: string | null
  },
) {
  return requestMobile<MobileModelSelection>(
    connection,
    `/api/mobile/sessions/${encodeURIComponent(sessionID)}/model-selection`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  )
}

export async function getSessionTasks(connection: MobileConnection, sessionID: string) {
  return requestMobile<MobileSessionTaskListView>(
    connection,
    `/api/mobile/sessions/${encodeURIComponent(sessionID)}/tasks`,
  )
}

export async function getWorkspaceFiles(connection: MobileConnection, workspaceID: string, path?: string) {
  const params = new URLSearchParams()
  if (path) params.set("path", path)
  const query = params.toString()
  return requestMobile<MobileWorkspaceFileEntry[]>(
    connection,
    `/api/mobile/workspaces/${encodeURIComponent(workspaceID)}/files${query ? `?${query}` : ""}`,
  )
}

export async function searchWorkspaceFiles(connection: MobileConnection, workspaceID: string, queryText: string) {
  const params = new URLSearchParams()
  params.set("q", queryText)
  return requestMobile<MobileWorkspaceFileSearchResult[]>(
    connection,
    `/api/mobile/workspaces/${encodeURIComponent(workspaceID)}/files/search?${params.toString()}`,
  )
}

export async function getWorkspaceFileContent(connection: MobileConnection, workspaceID: string, filePath: string) {
  const params = new URLSearchParams()
  params.set("path", filePath)
  return requestMobile<MobileWorkspaceFileDocument>(
    connection,
    `/api/mobile/workspaces/${encodeURIComponent(workspaceID)}/files/content?${params.toString()}`,
  )
}

export async function getWorkspaceDiff(connection: MobileConnection, workspaceID: string) {
  return requestMobile<MobileWorkspaceDiffSummary | null>(
    connection,
    `/api/mobile/workspaces/${encodeURIComponent(workspaceID)}/diff`,
  )
}

export async function getApprovals(
  connection: MobileConnection,
  input?: { sessionID?: string; status?: MobileApprovalStatus },
) {
  const params = new URLSearchParams()
  if (input?.status) params.set("status", input.status)
  if (input?.sessionID) params.set("sessionID", input.sessionID)
  const query = params.toString()
  return requestMobile<MobileApproval[]>(connection, `/api/mobile/approvals${query ? `?${query}` : ""}`)
}

export async function respondApproval(
  connection: MobileConnection,
  approvalID: string,
  decision: "approve" | "deny",
  input?: {
    note?: string
    resume?: boolean
  },
) {
  return requestMobile<unknown>(connection, `/api/mobile/approvals/${encodeURIComponent(approvalID)}/${decision}`, {
    method: "POST",
    body: JSON.stringify({
      note: input?.note,
      resume: input?.resume ?? true,
    }),
  })
}

export async function sendPrompt(
  connection: MobileConnection,
  sessionID: string,
  text: string,
  callbacks?: MobileStreamCallbacks,
) {
  return requestMobileStream(
    connection,
    `/api/mobile/sessions/${encodeURIComponent(sessionID)}/messages/stream`,
    {
      method: "POST",
      body: JSON.stringify({ text }),
    },
    callbacks,
  )
}

export async function resumeSession(
  connection: MobileConnection,
  sessionID: string,
  callbacks?: MobileStreamCallbacks,
) {
  return requestMobileStream(
    connection,
    `/api/mobile/sessions/${encodeURIComponent(sessionID)}/resume/stream`,
    {
      method: "POST",
    },
    callbacks,
  )
}

export async function cancelSession(connection: MobileConnection, sessionID: string) {
  return requestMobile<unknown>(connection, `/api/mobile/sessions/${encodeURIComponent(sessionID)}/cancel`, {
    method: "POST",
  })
}

export async function revokeCurrentDevice(connection: MobileConnection) {
  if (isRelayConnection(connection)) {
    return requestRelay<{ deviceID: string; revoked: boolean }>(connection, "/api/relay/devices/me/revoke", {
      method: "POST",
    })
  }

  return requestMobile<{ deviceID: string; revoked: boolean }>(connection, "/api/mobile/devices/me/revoke", {
    method: "POST",
  })
}

export function mobileEventsURL(connection: MobileConnection) {
  return mobileStreamURL(connection, "/api/mobile/events/stream")
}

export function mobileSessionEventsURL(connection: MobileConnection, sessionID: string) {
  return mobileStreamURL(connection, `/api/mobile/sessions/${encodeURIComponent(sessionID)}/events/stream`)
}

export function mobileStreamURL(connection: MobileConnection, path: string) {
  if (isRelayConnection(connection)) {
    const params = new URLSearchParams({
      desktopID: connection.desktopID,
      path,
    })
    return `${connection.baseUrl}/api/relay/mobile/stream?${params.toString()}`
  }
  return `${connection.baseUrl}${path}`
}

export function isRelayConnection(connection: MobileConnection | null | undefined): connection is MobileConnection & { transport: "relay"; desktopID: string } {
  return connection?.transport === "relay" && Boolean(connection.desktopID)
}

async function requestRelayMobile<T>(
  connection: MobileConnection & { transport: "relay"; desktopID: string },
  path: string,
  init?: RequestInit,
): Promise<T> {
  const result = await requestRelayCommand<RelayMobileHttpResult>(connection, "mobile.http", {
    method: (init?.method ?? "GET").toString(),
    path,
    body: typeof init?.body === "string" ? init.body : undefined,
    headers: pickRelayRequestHeaders(init?.headers),
  })

  const value = result.body ?? parseJson(result.text ?? "")
  if (result.status < 200 || result.status >= 300) {
    const envelope = isEnvelope<unknown>(value) ? value : undefined
    const message = envelope?.success === false ? envelope.error?.message : undefined
    const code = envelope?.success === false ? envelope.error?.code : undefined
    throw new MobileApiError(message || `Request failed with HTTP ${result.status}.`, result.status, code)
  }

  if (isEnvelope<T>(value)) {
    if (value.success) return value.data
    throw new MobileApiError(value.error?.message || "Mobile relay request failed.", result.status, value.error?.code)
  }

  return value as T
}

async function requestRelayCommand<T>(
  connection: MobileConnection & { transport: "relay"; desktopID: string },
  type: string,
  payload?: unknown,
): Promise<T> {
  return requestRelay<T>(connection, "/api/relay/commands", {
    method: "POST",
    body: JSON.stringify({
      desktopID: connection.desktopID,
      type,
      payload,
    }),
  })
}

async function requestRelay<T>(connection: MobileConnection, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${connection.baseUrl}${path}`, {
    ...init,
    headers: buildHeaders(connection, init?.headers),
  }).catch((error: unknown) => {
    const detail = error instanceof Error && error.message ? ` ${error.message}` : ""
    throw new MobileApiError(`Unable to reach ${connection.baseUrl}. Check your network and try again.${detail}`, 0)
  })

  const text = await response.text()
  const value = parseJson(text)

  if (!response.ok) {
    const envelope = isEnvelope<unknown>(value) ? value : undefined
    const message = envelope?.success === false ? envelope.error?.message : readErrorMessage(value)
    const code = envelope?.success === false ? envelope.error?.code : readErrorCode(value)
    throw new MobileApiError(message || `Request failed with HTTP ${response.status}.`, response.status, code)
  }

  if (isEnvelope<T>(value)) {
    if (value.success) return value.data
    throw new MobileApiError(value.error?.message || "Relay request failed.", response.status, value.error?.code)
  }

  return value as T
}

async function requestMobile<T>(connection: MobileConnection, path: string, init?: RequestInit): Promise<T> {
  if (isRelayConnection(connection)) {
    return requestRelayMobile<T>(connection, path, init)
  }

  const response = await fetch(`${connection.baseUrl}${path}`, {
    ...init,
    headers: buildHeaders(connection, init?.headers),
  }).catch((error: unknown) => {
    const detail = error instanceof Error && error.message ? ` ${error.message}` : ""
    throw new MobileApiError(`Unable to reach ${connection.baseUrl}. Check that the phone and desktop are on the same network, then refresh the QR code.${detail}`, 0)
  })

  const text = await response.text()
  const value = parseJson(text)

  if (!response.ok) {
    const envelope = isEnvelope<unknown>(value) ? value : undefined
    const message = envelope?.success === false ? envelope.error?.message : undefined
    const code = envelope?.success === false ? envelope.error?.code : undefined
    throw new MobileApiError(message || `Request failed with HTTP ${response.status}.`, response.status, code)
  }

  if (isEnvelope<T>(value)) {
    if (value.success) return value.data
    throw new MobileApiError(value.error?.message || "Mobile bridge request failed.", response.status, value.error?.code)
  }

  return value as T
}

async function requestMobileStream(
  connection: MobileConnection,
  path: string,
  init?: RequestInit,
  callbacks?: MobileStreamCallbacks,
) {
  let response: Response
  if (isRelayConnection(connection)) {
    response = await requestRelayMobileStream(connection, path, init)
  } else {
    response = await fetch(`${connection.baseUrl}${path}`, {
      ...init,
      headers: buildHeaders(connection, init?.headers),
    }).catch((error: unknown) => {
      const detail = error instanceof Error && error.message ? ` ${error.message}` : ""
      throw new MobileApiError(`Unable to reach ${connection.baseUrl}. Check that the phone and desktop are on the same network, then refresh the QR code.${detail}`, 0)
    })
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    const value = parseJson(text)
    const envelope = isEnvelope<unknown>(value) ? value : undefined
    const message = envelope?.success === false ? envelope.error?.message : undefined
    const code = envelope?.success === false ? envelope.error?.code : undefined
    throw new MobileApiError(message || `Request failed with HTTP ${response.status}.`, response.status, code)
  }

  callbacks?.onOpen?.()
  await readMobileSSEStream(response, callbacks)
}

async function requestRelayMobileStream(
  connection: MobileConnection & { transport: "relay"; desktopID: string },
  path: string,
  init?: RequestInit,
) {
  return fetch(`${connection.baseUrl}/api/relay/mobile/stream`, {
    method: "POST",
    headers: buildHeaders(connection),
    body: JSON.stringify({
      desktopID: connection.desktopID,
      method: (init?.method ?? "GET").toString().toUpperCase(),
      path,
      body: typeof init?.body === "string" ? init.body : undefined,
      headers: pickRelayRequestHeaders(init?.headers),
    }),
  }).catch((error: unknown) => {
    const detail = error instanceof Error && error.message ? ` ${error.message}` : ""
    throw new MobileApiError(`Unable to reach ${connection.baseUrl}. Check your network and try again.${detail}`, 0)
  })
}

function buildHeaders(connection: MobileConnection, headers?: HeadersInit): HeadersInit {
  const nextHeaders: HeadersInit = {
    accept: "application/json, text/event-stream, text/plain",
    "content-type": "application/json",
    ...headers,
  }
  if (connection.token) {
    return {
      authorization: `Bearer ${connection.token}`,
      ...nextHeaders,
    }
  }
  return nextHeaders
}

function pickRelayRequestHeaders(headers?: HeadersInit): Record<string, string> {
  const result: Record<string, string> = {}
  if (!headers) return result

  const source = new Headers(headers)
  const contentType = source.get("content-type")
  if (contentType) result["content-type"] = contentType
  return result
}

function parseJson(text: string) {
  if (!text.trim()) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function readErrorMessage(value: unknown) {
  const record = readRecord(value)
  const error = readRecord(record?.error)
  return typeof error?.message === "string" ? error.message : undefined
}

function readErrorCode(value: unknown) {
  const record = readRecord(value)
  const error = readRecord(record?.error)
  return typeof error?.code === "string" ? error.code : undefined
}

function isEnvelope<T>(value: unknown): value is Envelope<T> {
  return Boolean(value && typeof value === "object" && "success" in value)
}

async function readMobileSSEStream(response: Response, callbacks?: MobileStreamCallbacks) {
  const reader = response.body?.getReader()
  if (!reader) {
    const text = await response.text().catch(() => "")
    const parsed = consumeSSEBuffer(text, true)
    for (const event of parsed.events) emitMobileStreamEvent(event, callbacks)
    return
  }

  const decoder = createTextDecoder()
  let buffer = ""

  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    buffer += decodeChunk(decoder, chunk.value, true)
    const parsed = consumeSSEBuffer(buffer)
    buffer = parsed.remainder
    for (const event of parsed.events) emitMobileStreamEvent(event, callbacks)
  }

  buffer += decodeChunk(decoder, undefined, false)
  const trailing = consumeSSEBuffer(buffer, true)
  for (const event of trailing.events) emitMobileStreamEvent(event, callbacks)
}

function emitMobileStreamEvent(event: MobileStreamEvent, callbacks?: MobileStreamCallbacks) {
  callbacks?.onEvent?.(event)
  const delta = readMobileStreamTextDelta(event)
  if (delta) callbacks?.onTextDelta?.(delta)
}

function readMobileStreamTextDelta(event: MobileStreamEvent): MobileStreamTextDelta | null {
  const data = readRecord(event.data)
  if (!data) return null

  const eventKind = data.kind
  if (event.event === "delta" && isMobileStreamTextDeltaKind(eventKind) && typeof data.delta === "string") {
    return { kind: eventKind, delta: data.delta }
  }

  if (event.event !== "runtime") return null
  if (data.type !== "text.part.delta" && data.type !== "reasoning.part.delta") return null
  const payload = readRecord(data.payload)
  if (typeof payload?.delta !== "string") return null
  return {
    kind: data.type === "reasoning.part.delta" ? "reasoning" : "text",
    delta: payload.delta,
    sourceID: typeof payload.partID === "string" && payload.partID.trim() ? payload.partID : undefined,
  }
}

function isMobileStreamTextDeltaKind(value: unknown): value is MobileStreamTextDeltaKind {
  return value === "text" || value === "reasoning"
}

function consumeSSEBuffer(raw: string, flush = false) {
  const events: MobileStreamEvent[] = []
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
    return { events, remainder: "" }
  }

  return { events, remainder }
}

function parseSSEBlock(block: string): MobileStreamEvent | null {
  if (!block.trim()) return null

  let id = ""
  let event = ""
  const dataLines: string[] = []

  for (const rawLine of block.split(/\r?\n/)) {
    if (!rawLine || rawLine.startsWith(":")) continue
    const separatorIndex = rawLine.indexOf(":")
    const field = separatorIndex === -1 ? rawLine : rawLine.slice(0, separatorIndex)
    let value = separatorIndex === -1 ? "" : rawLine.slice(separatorIndex + 1)
    if (value.startsWith(" ")) value = value.slice(1)

    if (field === "id") {
      id = value.trim()
    } else if (field === "event") {
      event = value.trim()
    } else if (field === "data") {
      dataLines.push(value)
    }
  }

  const payload = dataLines.join("\n")
  if (!event || !payload) return null

  return {
    ...(id ? { id } : {}),
    event,
    data: parseJson(payload),
  }
}

function createTextDecoder() {
  try {
    return new TextDecoder()
  } catch {
    return null
  }
}

function decodeChunk(decoder: TextDecoder | null, value: Uint8Array | undefined, stream: boolean) {
  if (decoder) return decoder.decode(value, { stream })
  if (!value) return ""
  return Array.from(value, (item) => String.fromCharCode(item)).join("")
}

function readRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null
}
