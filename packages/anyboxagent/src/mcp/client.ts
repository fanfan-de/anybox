import { type Stream } from "node:stream"
import { pathToFileURL } from "node:url"
import {
  Client,
  SdkErrorCode,
  StreamableHTTPClientTransport,
  isSpecType,
  type ElicitRequest,
  type ElicitResult,
  type JSONValue,
  type McpSubscription,
  type ProtocolEra,
  type ReadResourceResult,
  type Resource,
  type ResourceTemplateType,
  type SubscriptionFilter,
} from "@modelcontextprotocol/client"
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio"
import type { McpServerSummary } from "#config/config.ts"
import type { ResolvedConnectorRuntime } from "#connector/connector.ts"
import * as BuiltinMcp from "#mcp/builtin.ts"
import {
  getBrowserAuthorizationEnvironment,
  signBrowserAuthorizationReceipt,
} from "#permission/authorization-receipt.ts"
import * as Log from "#util/log.ts"

const log = Log.create({ service: "mcp.client" })
const MCP_LEGACY_CACHE_TTL_MS = 30_000
const MCP_SESSION_TERMINATION_TIMEOUT_MS = 2_000
const MCP_SUBSCRIPTION_RETRY_MAX_MS = 30_000
const MCP_SUBSCRIPTION_RETRY_MIN_MS = 1_000
const MCP_FATAL_REQUEST_ERROR_CODES = new Set<string>([
  SdkErrorCode.RequestTimeout,
  SdkErrorCode.ConnectionClosed,
  SdkErrorCode.NotConnected,
  SdkErrorCode.SendFailed,
  SdkErrorCode.EraNegotiationFailed,
  SdkErrorCode.ClientHttpFailedToOpenStream,
])

export interface McpToolDefinition {
  name: string
  title?: string
  description?: string
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  annotations?: {
    title?: string
    readOnlyHint?: boolean
    destructiveHint?: boolean
    idempotentHint?: boolean
    openWorldHint?: boolean
  }
}

export interface McpToolCallResult {
  content: unknown[]
  structuredContent?: JSONValue
  isError?: boolean
}

export type McpResourceDefinition = Resource
export type McpResourceTemplateDefinition = ResourceTemplateType
export type McpResourceReadResult = ReadResourceResult

export interface McpClientOptions {
  cwd: string
  onResourcesChanged?: () => void
  onToolsChanged?: () => void
  onInvalidated?: (error: unknown) => void | Promise<void>
  requestTimeoutMs: number
  server: McpServerSummary
  worktree: string
  onElicitation?: (request: ElicitRequest) => Promise<ElicitResult>
}

export interface McpToolRequestContext {
  [key: string]: unknown
  sessionID?: string
  turnID?: string
  messageID?: string
  toolCallID?: string
}

export interface McpClientLike {
  dispose(): Promise<void>
  getProtocolEra(): ProtocolEra | undefined
  listTools(abort?: AbortSignal): Promise<McpToolDefinition[]>
  listResources(abort?: AbortSignal): Promise<McpResourceDefinition[]>
  listResourceTemplates(abort?: AbortSignal): Promise<McpResourceTemplateDefinition[]>
  readResource(uri: string, abort?: AbortSignal): Promise<McpResourceReadResult>
  callTool(
    toolName: string,
    args: Record<string, unknown> | undefined,
    abort?: AbortSignal,
    context?: McpToolRequestContext,
  ): Promise<McpToolCallResult>
  notifyLifecycle(input: {
    type: string
    context: {
      sessionID: string
      turnID: string
    }
    detail?: Record<string, unknown>
  }): Promise<void>
}

function getToolDisplayName(tool: McpToolDefinition) {
  return tool.title || tool.annotations?.title || tool.name
}

function mergeProcessEnv(overrides?: Record<string, string>) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string",
    ),
  )

  return {
    ...env,
    ...(overrides ?? {}),
  }
}

function isAnyboxNodeReplServer(server: McpServerSummary) {
  return BuiltinMcp.isNodeReplServer(server)
}

function normalizedRequestContext(
  context: McpToolRequestContext | undefined,
): McpToolRequestContext | undefined {
  const normalized = Object.fromEntries(
    (["sessionID", "turnID", "messageID", "toolCallID"] as const).flatMap((key) => {
      const value = context?.[key]
      return typeof value === "string" && value.trim()
        ? [[key, value.trim()] as const]
        : []
    }),
  )
  return Object.keys(normalized).length > 0 ? normalized : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

async function handleAnyboxPermissionElicitation(
  request: ElicitRequest,
): Promise<ElicitResult> {
  const requestMeta = asRecord(request.params._meta)
  const input = asRecord(requestMeta?.["anybox/permission"])
  const context = asRecord(input?.context)
  const scope = asRecord(input?.scope)
  if (!input || !context || !scope) {
    return { action: "decline" }
  }
  const challenge = asRecord(input.challenge)
  if (challenge) {
    for (const key of [
      "sessionID",
      "turnID",
      "messageID",
      "toolCallID",
    ] as const) {
      if (
        typeof challenge[key] !== "string"
        || challenge[key] !== context[key]
      ) {
        return { action: "decline" }
      }
    }
  }
  const authorizedInput = challenge ?? input
  const sessionID = String(context.sessionID ?? "")
  const normalizedScope = scope.kind === "browser-origin"
    ? {
        kind: "browser-origin" as const,
        sessionID,
        extensionInstanceID: String(
          authorizedInput.extensionInstanceID ?? scope.extensionInstanceID ?? "",
        ),
        origin: String(authorizedInput.origin ?? scope.origin ?? ""),
        browserID: typeof authorizedInput.browserID === "string"
          ? authorizedInput.browserID
          : typeof scope.browserID === "string"
            ? scope.browserID
            : undefined,
      }
    : scope.kind === "plugin-action"
      ? {
          kind: "plugin-action" as const,
          sessionID,
          pluginID: String(scope.pluginID ?? ""),
          pluginDisplayName: String(scope.pluginDisplayName ?? ""),
          actionTitle: String(scope.actionTitle ?? ""),
          actionSummary: String(scope.actionSummary ?? ""),
          actionBody: typeof scope.actionBody === "string"
            ? scope.actionBody
            : undefined,
        }
      : undefined
  if (!normalizedScope) {
    return { action: "decline" }
  }

  const permission = await import("#permission/permission.ts")
  const result = await permission.requestInProcessPermission({
    context: {
      sessionID,
      turnID: String(context.turnID ?? ""),
      messageID: String(context.messageID ?? ""),
      toolCallID: String(context.toolCallID ?? ""),
    },
    scope: normalizedScope,
    grantID: typeof authorizedInput.grantID === "string"
      ? authorizedInput.grantID
      : undefined,
    method: String(authorizedInput.method ?? ""),
    tabID: typeof authorizedInput.tabID === "number"
      ? authorizedInput.tabID
      : typeof authorizedInput.tabId === "number"
        ? authorizedInput.tabId
        : undefined,
    tabTitle: typeof authorizedInput.tabTitle === "string"
      ? authorizedInput.tabTitle
      : undefined,
    risk: authorizedInput.risk === "low"
      || authorizedInput.risk === "medium"
      || authorizedInput.risk === "high"
      || authorizedInput.risk === "critical"
      ? authorizedInput.risk
      : undefined,
    sensitive: authorizedInput.sensitive === true,
    action: authorizedInput.permissionAction === "allow"
      || authorizedInput.permissionAction === "ask"
      || authorizedInput.permissionAction === "deny"
      ? authorizedInput.permissionAction
      : authorizedInput.action === "allow"
        || authorizedInput.action === "ask"
        || authorizedInput.action === "deny"
        ? authorizedInput.action
      : undefined,
    rationale: typeof authorizedInput.rationale === "string"
      ? authorizedInput.rationale
      : undefined,
    timeoutMs: typeof input.timeoutMs === "number" ? input.timeoutMs : undefined,
  })
  const authorization = result.decision !== "deny" && challenge
    ? signBrowserAuthorizationReceipt({
        challenge,
        context: {
          sessionID: String(context.sessionID ?? ""),
          turnID: String(context.turnID ?? ""),
          messageID: String(context.messageID ?? ""),
          toolCallID: String(context.toolCallID ?? ""),
        },
        decision: result.decision === "allow-session"
          ? "allow-session"
          : "allow-once",
      })
    : undefined

  return {
    action: "accept",
    content: {
      decision: result.decision,
      grantID: result.grantID,
      ...(authorization ? { authorization } : {}),
    },
  }
}

function resolveAuthorizationHeader(authorization: string | undefined) {
  if (!authorization) return undefined
  if (/^[A-Za-z][A-Za-z0-9+.-]*\s+\S/.test(authorization)) {
    return authorization
  }

  return `Bearer ${authorization}`
}

function buildRemoteHeaders(server: {
  authorization?: string
  headers?: Record<string, string>
}) {
  const authorization = resolveAuthorizationHeader(server.authorization)
  const headers: Record<string, string> = {
    ...(server.headers ?? {}),
  }

  if (authorization) {
    headers.Authorization = authorization
  }

  return Object.keys(headers).length > 0 ? headers : undefined
}

async function settleWithin(promise: Promise<unknown>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const settled = promise.then(
    () => undefined,
    () => undefined,
  )
  try {
    await Promise.race([
      settled,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function abortReason(signal: AbortSignal) {
  if (signal.reason instanceof Error) return signal.reason
  const error = new Error(
    typeof signal.reason === "string" && signal.reason.trim()
      ? signal.reason
      : "MCP request aborted.",
  )
  error.name = "AbortError"
  return error
}

function isFatalRequestFailure(error: unknown, abort?: AbortSignal) {
  if (abort?.aborted) return true
  if (!error || typeof error !== "object") return false
  const code = (error as { code?: unknown }).code
  if (typeof code === "string" && MCP_FATAL_REQUEST_ERROR_CODES.has(code)) return true
  const message = error instanceof Error ? error.message.toLowerCase() : ""
  return (
    message.includes("request timed out")
    || message.includes("connection closed")
    || message.includes("not connected")
    || message.includes("transport closed")
    || message.includes("socket closed")
    || message.includes("broken pipe")
  )
}

function normalizeCallResult(result: unknown): McpToolCallResult {
  if (result && typeof result === "object" && Array.isArray((result as { content?: unknown[] }).content)) {
    return result as McpToolCallResult
  }

  if (result && typeof result === "object" && "toolResult" in (result as Record<string, unknown>)) {
    const toolResult = (result as { toolResult: unknown }).toolResult
    return {
      content: [
        {
          type: "text",
          text: typeof toolResult === "string"
            ? toolResult
            : JSON.stringify(toolResult) ?? String(toolResult),
        },
      ],
      structuredContent: isSpecType.JSONValue(toolResult) ? toolResult : undefined,
      isError: false,
    }
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result),
      },
    ],
    isError: false,
  }
}

export class McpClient {
  private client?: Client
  private closed = false
  private closePromise?: Promise<void>
  private initializePromise?: Promise<Client>
  private readonly options: McpClientOptions
  private readonly stderrLines: string[] = []
  private stderrStream?: Stream | null
  private subscriptionRetryTimer?: ReturnType<typeof setTimeout>
  private transport?: StdioClientTransport | StreamableHTTPClientTransport

  constructor(options: McpClientOptions) {
    this.options = options
  }

  async dispose() {
    await this.closeConnection()
  }

  async listTools(abort?: AbortSignal): Promise<McpToolDefinition[]> {
    const result = await this.runRequest(abort, (client) => client.listTools(undefined, {
      signal: abort,
      timeout: this.options.requestTimeoutMs,
    }))
    return result.tools as McpToolDefinition[]
  }

  async listResources(abort?: AbortSignal): Promise<Resource[]> {
    const result = await this.runRequest(abort, (client) => client.listResources(undefined, {
      signal: abort,
      timeout: this.options.requestTimeoutMs,
    }))
    return result.resources
  }

  async listResourceTemplates(abort?: AbortSignal): Promise<ResourceTemplateType[]> {
    const result = await this.runRequest(abort, (client) => client.listResourceTemplates(undefined, {
      signal: abort,
      timeout: this.options.requestTimeoutMs,
    }))
    return result.resourceTemplates
  }

  getProtocolEra(): ProtocolEra | undefined {
    return this.client?.getProtocolEra()
  }

  async readResource(uri: string, abort?: AbortSignal): Promise<ReadResourceResult> {
    return await this.runRequest(abort, (client) => client.readResource(
      {
        uri,
      },
      {
        signal: abort,
        timeout: this.options.requestTimeoutMs,
      },
    ))
  }

  async callTool(
    toolName: string,
    args: Record<string, unknown> | undefined,
    abort?: AbortSignal,
    context?: McpToolRequestContext,
  ): Promise<McpToolCallResult> {
    const requestContext = normalizedRequestContext(context)
    const requestMeta = isAnyboxNodeReplServer(this.options.server)
      ? requestContext
      : undefined

    return normalizeCallResult(await this.runRequest(abort, (client) => client.callTool(
      {
        name: toolName,
        arguments: args,
        ...(requestMeta ? { _meta: requestMeta } : {}),
      },
      {
        signal: abort,
        timeout: this.options.requestTimeoutMs,
      },
    )))
  }

  async notifyLifecycle(input: {
    type: string
    context: {
      sessionID: string
      turnID: string
    }
    detail?: Record<string, unknown>
  }) {
    if (!isAnyboxNodeReplServer(this.options.server)) return
    await this.runRequest(undefined, (client) => client.notification({
      method: "notifications/anybox/lifecycle",
      params: input,
    } as never))
  }

  private async runRequest<T>(
    abort: AbortSignal | undefined,
    request: (client: Client) => Promise<T>,
  ): Promise<T> {
    try {
      if (abort?.aborted) throw abortReason(abort)
      const client = await this.waitForAbort(this.ensureInitialized(abort), abort)
      return await this.waitForAbort(request(client), abort)
    } catch (error) {
      if (isFatalRequestFailure(error, abort)) {
        await this.invalidate(error)
      }
      throw error
    }
  }

  private waitForAbort<T>(promise: Promise<T>, abort?: AbortSignal): Promise<T> {
    if (!abort) return promise
    if (abort.aborted) return Promise.reject(abortReason(abort))
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(abortReason(abort))
      abort.addEventListener("abort", onAbort, { once: true })
      promise.then(resolve, reject).finally(() => {
        abort.removeEventListener("abort", onAbort)
      })
    })
  }

  private async closeConnection() {
    if (this.closePromise) return this.closePromise
    this.closed = true
    this.clearSubscriptionRetry()

    const promise = (async () => {
      const client = this.client
      const transport = this.transport
      if (transport instanceof StreamableHTTPClientTransport && transport.sessionId) {
        await settleWithin(
          transport.terminateSession(),
          Math.min(
            Math.max(this.options.requestTimeoutMs, 250),
            MCP_SESSION_TERMINATION_TIMEOUT_MS,
          ),
        )
      }

      if (client) {
        await client.close().catch(() => undefined)
      } else if (transport) {
        await transport.close().catch(() => undefined)
      }

      this.stderrStream?.removeAllListeners()
      this.stderrStream = undefined
      this.transport = undefined
      this.client = undefined
      this.initializePromise = undefined
    })()
    this.closePromise = promise
    return promise
  }

  private async invalidate(error: unknown) {
    const shouldNotify = !this.closed
    await this.closeConnection()
    if (shouldNotify) await this.options.onInvalidated?.(error)
  }

  private async ensureInitialized(abort?: AbortSignal) {
    if (this.initializePromise) return this.initializePromise

    const promise = (async () => {
      if (this.closed) {
        throw new Error(`MCP server '${this.options.server.id}' is closed.`)
      }

      const client = new Client(
        {
          name: "anyboxagent",
          version: "1.0.0",
        },
        {
          capabilities: {
            ...(isAnyboxNodeReplServer(this.options.server)
              ? {
                  elicitation: {
                    form: {},
                  },
                }
              : {}),
            roots: {
              listChanged: false,
            },
          },
          defaultCacheTtlMs: MCP_LEGACY_CACHE_TTL_MS,
          listChanged: {
            resources: {
              onChanged: (error) => {
                if (error) {
                  log.warn("failed to refresh mcp resources after list_changed", {
                    serverID: this.options.server.id,
                    error: error instanceof Error ? error.message : String(error),
                  })
                }
                this.options.onResourcesChanged?.()
              },
            },
            tools: {
              onChanged: (error) => {
                if (error) {
                  log.warn("failed to refresh mcp tools after list_changed", {
                    serverID: this.options.server.id,
                    error: error instanceof Error ? error.message : String(error),
                  })
                }
                this.options.onToolsChanged?.()
              },
            },
          },
          versionNegotiation: {
            mode: "auto",
          },
        },
      )

      client.setRequestHandler("roots/list", async () => ({
        roots: [this.options.cwd, this.options.worktree]
          .filter((value, index, all) => value && all.indexOf(value) === index)
          .map((value) => ({
            uri: pathToFileURL(value).toString(),
            name: value === this.options.cwd ? "cwd" : "worktree",
          })),
      }))
      if (isAnyboxNodeReplServer(this.options.server)) {
        client.setRequestHandler(
          "elicitation/create",
          this.options.onElicitation ?? handleAnyboxPermissionElicitation,
        )
      }
      const transport = await this.createTransport()
      if (this.closed) {
        await transport.close().catch(() => undefined)
        throw new Error(`MCP server '${this.options.server.id}' is closed.`)
      }
      client.onerror = (error) => {
        if (this.closed) return
        log.warn("mcp client error", {
          serverID: this.options.server.id,
          error: error instanceof Error ? error.message : String(error),
          detail: this.stderrLines.at(-1),
        })
      }
      client.onclose = () => {
        if (this.closed) return
        log.warn("mcp client closed", {
          serverID: this.options.server.id,
          detail: this.stderrLines.at(-1),
        })
        void this.invalidate(new Error(`MCP server '${this.options.server.id}' connection closed.`))
      }

      this.transport = transport
      this.client = client
      await client.connect(transport, {
        signal: abort,
        timeout: this.options.requestTimeoutMs,
      })
      if (this.closed || this.client !== client) {
        await client.close().catch(() => undefined)
        throw new Error(`MCP server '${this.options.server.id}' is closed.`)
      }
      this.watchSubscription(client, client.autoOpenedSubscription)
      return client
    })().catch(async (error) => {
      const detail = this.stderrHint()
      const enhanced = error instanceof Error && detail
        ? Object.assign(new Error(`${error.message}${detail}`), {
            code: (error as { code?: unknown }).code,
          })
        : error
      await this.invalidate(enhanced)
      throw enhanced
    })

    this.initializePromise = promise
    return await promise
  }

  private watchSubscription(client: Client, subscription: McpSubscription | undefined) {
    if (!subscription) return
    void subscription.closed.then((cause) => {
      if (cause === "local" || this.closed || this.client !== client) return
      log.warn("mcp list_changed subscription closed", {
        serverID: this.options.server.id,
        cause,
      })
      this.scheduleSubscriptionRestart(client, subscription.honoredFilter, 0)
    })
  }

  private scheduleSubscriptionRestart(client: Client, filter: SubscriptionFilter, attempt: number) {
    if (this.closed || this.client !== client) return
    this.clearSubscriptionRetry()
    const delay = Math.min(
      MCP_SUBSCRIPTION_RETRY_MIN_MS * 2 ** attempt,
      MCP_SUBSCRIPTION_RETRY_MAX_MS,
    )
    this.subscriptionRetryTimer = setTimeout(() => {
      this.subscriptionRetryTimer = undefined
      if (this.closed || this.client !== client) return
      void client.listen(filter, {
        timeout: this.options.requestTimeoutMs,
      }).then((subscription) => {
        if (this.closed || this.client !== client) {
          void subscription.close().catch(() => undefined)
          return
        }
        this.watchSubscription(client, subscription)
        void this.refreshSubscriptionLists(client, subscription.honoredFilter).catch((error) => {
          log.warn("failed to complete mcp subscription restart refresh", {
            serverID: this.options.server.id,
            error: error instanceof Error ? error.message : String(error),
          })
        })
      }, (error) => {
        if (this.closed || this.client !== client) return
        log.warn("failed to restart mcp list_changed subscription", {
          serverID: this.options.server.id,
          attempt: attempt + 1,
          error: error instanceof Error ? error.message : String(error),
        })
        this.scheduleSubscriptionRestart(client, filter, attempt + 1)
      })
    }, delay)
    this.subscriptionRetryTimer.unref?.()
  }

  private async refreshSubscriptionLists(client: Client, filter: SubscriptionFilter) {
    const refreshes: Promise<void>[] = []

    if (filter.toolsListChanged) {
      refreshes.push(this.refreshSubscriptionList(
        client,
        "tools",
        () => client.listTools(undefined, {
          cacheMode: "refresh",
          timeout: this.options.requestTimeoutMs,
        }),
        this.options.onToolsChanged,
      ))
    }

    if (filter.resourcesListChanged) {
      refreshes.push(this.refreshSubscriptionList(
        client,
        "resources and templates",
        async () => {
          const results = await Promise.allSettled([
            client.listResources(undefined, {
              cacheMode: "refresh",
              timeout: this.options.requestTimeoutMs,
            }),
            client.listResourceTemplates(undefined, {
              cacheMode: "refresh",
              timeout: this.options.requestTimeoutMs,
            }),
          ])
          const failure = results.find((result) => result.status === "rejected")
          if (failure?.status === "rejected") throw failure.reason
        },
        this.options.onResourcesChanged,
      ))
    }

    await Promise.all(refreshes)
  }

  private async refreshSubscriptionList(
    client: Client,
    label: string,
    refresh: () => Promise<unknown>,
    onChanged: (() => void) | undefined,
  ) {
    try {
      await refresh()
    } catch (error) {
      log.warn(`failed to refresh mcp ${label} after subscription restart`, {
        serverID: this.options.server.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    if (this.closed || this.client !== client) return
    onChanged?.()
  }

  private clearSubscriptionRetry() {
    if (!this.subscriptionRetryTimer) return
    clearTimeout(this.subscriptionRetryTimer)
    this.subscriptionRetryTimer = undefined
  }

  private async createTransport() {
    if (this.options.server.transport === "connector") {
      return this.createResolvedConnectorTransport(
        await this.resolveConnectorRuntime(
          this.options.server.connectorId,
          this.options.server.connectorRuntimeId,
        ),
      )
    }

    if (this.options.server.transport === "remote") {
      const connectorRuntime = this.options.server.connectorId
        ? await this.resolveConnectorRuntime(
            this.options.server.connectorId,
            this.options.server.connectorRuntimeId,
          )
        : undefined
      if (connectorRuntime?.transport === "stdio") {
        return this.createResolvedConnectorTransport(connectorRuntime)
      }

      const serverUrl = this.options.server.serverUrl ?? connectorRuntime?.serverUrl
      if (!serverUrl) {
        throw new Error(
          `MCP server '${this.options.server.id}' is missing serverUrl and has no resolvable connector runtime.`,
        )
      }

      const remoteServer = {
        authorization: connectorRuntime?.authorization ?? this.options.server.authorization,
        headers: {
          ...(this.options.server.headers ?? {}),
          ...(connectorRuntime?.headers ?? {}),
        },
      }

      return new StreamableHTTPClientTransport(new URL(serverUrl), {
        requestInit: (() => {
          const headers = buildRemoteHeaders(remoteServer)
          return headers ? { headers } : undefined
        })(),
      })
    }

    const transport = new StdioClientTransport({
      command: this.options.server.command,
      args: this.options.server.args ?? [],
      cwd: this.options.cwd,
      env: mergeProcessEnv({
        ...(this.options.server.env ?? {}),
        ...(isAnyboxNodeReplServer(this.options.server)
          ? getBrowserAuthorizationEnvironment()
          : {}),
      }),
      stderr: "pipe",
    })
    this.captureStderr(transport.stderr)
    return transport
  }

  private createResolvedConnectorTransport(runtime: ResolvedConnectorRuntime) {
    if (runtime.transport === "remote") {
      return new StreamableHTTPClientTransport(new URL(runtime.serverUrl), {
        requestInit: (() => {
          const headers = buildRemoteHeaders(runtime)
          return headers ? { headers } : undefined
        })(),
      })
    }

    const transport = new StdioClientTransport({
      command: runtime.command,
      args: runtime.args ?? [],
      cwd: runtime.cwd ?? this.options.cwd,
      env: mergeProcessEnv({
        ...(runtime.env ?? {}),
        ...(isAnyboxNodeReplServer(this.options.server)
          ? getBrowserAuthorizationEnvironment()
          : {}),
      }),
      stderr: "pipe",
    })
    this.captureStderr(transport.stderr)
    return transport
  }

  private async resolveConnectorRuntime(connectorId: string, runtimeID = "default") {
    const connectorModule = await import("#connector/connector.ts")
    return connectorModule.resolveRuntime(connectorId, runtimeID)
  }

  private captureStderr(stream: Stream | null) {
    this.stderrStream?.removeAllListeners()
    this.stderrStream = stream
    if (!stream) return

    const stderrStream = stream as NodeJS.ReadableStream & {
      setEncoding?: (encoding: BufferEncoding) => void
      on(event: "data", listener: (chunk: Buffer | string) => void): NodeJS.ReadableStream
    }
    stderrStream.setEncoding?.("utf8")
    stderrStream.on("data", (chunk) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8")
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed) continue
        this.stderrLines.push(trimmed)
        if (this.stderrLines.length > 50) {
          this.stderrLines.shift()
        }
      }
    })
  }

  private stderrHint() {
    const lastLine = this.stderrLines.at(-1)
    return lastLine ? ` Last stderr: ${lastLine}` : ""
  }
}

export function summarizeToolCallResult(result: McpToolCallResult) {
  const textParts: string[] = []

  for (const block of result.content) {
    if (!block || typeof block !== "object") continue
    const record = block as Record<string, unknown>

    if (record.type === "text" && typeof record.text === "string") {
      textParts.push(record.text)
      continue
    }

    if (record.type === "resource" && record.resource && typeof record.resource === "object") {
      const resource = record.resource as Record<string, unknown>
      if (typeof resource.text === "string") {
        textParts.push(resource.text)
      } else if (typeof resource.uri === "string") {
        textParts.push(resource.uri)
      }
      continue
    }

    if (record.type === "resource_link" && typeof record.uri === "string") {
      textParts.push(record.uri)
      continue
    }

    textParts.push(JSON.stringify(block))
  }

  const text = textParts.filter(Boolean).join("\n\n").trim()
  const fallback = result.structuredContent !== undefined
    ? result.structuredContent
    : result.content
  return {
    text: text || JSON.stringify(fallback),
    isError: result.isError ?? false,
  }
}

export function getMcpToolDisplayName(server: McpServerSummary, tool: McpToolDefinition) {
  return `${server.name ?? server.id}/${getToolDisplayName(tool)}`
}
