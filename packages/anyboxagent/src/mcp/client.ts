import { randomBytes } from "node:crypto"
import { type Stream } from "node:stream"
import { pathToFileURL } from "node:url"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { ElicitRequestSchema, ListRootsRequestSchema, RequestSchema } from "@modelcontextprotocol/sdk/types.js"
import type {
  ElicitRequest,
  ElicitResult,
  Notification,
  ReadResourceResult,
  Resource,
  ResourceTemplate,
  Result,
} from "@modelcontextprotocol/sdk/types.js"
import z from "zod"
import type { McpServerSummary } from "#config/config.ts"
import type { ResolvedConnectorRuntime } from "#connector/connector.ts"
import * as BuiltinMcp from "#mcp/builtin.ts"
import {
  getBrowserAuthorizationEnvironment,
  signBrowserAuthorizationReceipt,
} from "#permission/authorization-receipt.ts"
import * as Log from "#util/log.ts"

const log = Log.create({ service: "mcp.client" })

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
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

export type McpResourceDefinition = Resource
export type McpResourceTemplateDefinition = ResourceTemplate
export type McpResourceReadResult = ReadResourceResult

export interface McpClientOptions {
  cwd: string
  onResourcesChanged?: () => void
  onToolsChanged?: () => void
  requestTimeoutMs: number
  server: McpServerSummary
  worktree: string
  onElicitation?: (request: ElicitRequest) => Promise<ElicitResult>
  onPluginCapabilityCall?: (request: McpPluginCapabilityCall) => Promise<McpToolCallResult>
}

export interface McpToolRequestContext {
  sessionID?: string
  turnID?: string
  messageID?: string
  toolCallID?: string
}

export interface McpPluginCapabilityCall {
  capability: string
  operation: string
  arguments: Record<string, unknown>
  context: Required<McpToolRequestContext>
  signal?: AbortSignal
  claimMutation(): void
}

const PluginCapabilityRequestSchema = RequestSchema.extend({
  method: z.literal("anybox/plugin-capability/call"),
  params: z.object({
    token: z.string().trim().min(32).max(256),
    capability: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]*$/u),
    operation: z.string().trim().min(1).max(128),
    arguments: z.record(z.string(), z.unknown()),
    context: z.object({
      sessionID: z.string().trim().min(1).max(256),
      turnID: z.string().trim().min(1).max(256),
      messageID: z.string().trim().min(1).max(256),
      toolCallID: z.string().trim().min(1).max(256),
    }).strict(),
  }).strict(),
})
type PluginCapabilityRequest = z.infer<typeof PluginCapabilityRequestSchema>
type PluginCapabilityResult = Result & McpToolCallResult
type AnyboxMcpSdkClient = Client<PluginCapabilityRequest, Notification, PluginCapabilityResult>

type PluginCapabilityGrant = {
  context: Required<McpToolRequestContext>
  signal?: AbortSignal
  mutationClaimed: boolean
}

export interface McpClientLike {
  dispose(): Promise<void>
  listTools(): Promise<McpToolDefinition[]>
  listResources(): Promise<McpResourceDefinition[]>
  listResourceTemplates(): Promise<McpResourceTemplateDefinition[]>
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

function completeRequestContext(
  context: McpToolRequestContext | undefined,
): Required<McpToolRequestContext> | undefined {
  const normalized = normalizedRequestContext(context)
  if (
    !normalized?.sessionID
    || !normalized.turnID
    || !normalized.messageID
    || !normalized.toolCallID
  ) {
    return undefined
  }
  return normalized as Required<McpToolRequestContext>
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

  const permission = await import("#permission/permission.ts")
  const result = await permission.requestInProcessPermission({
    context: {
      sessionID: String(context.sessionID ?? ""),
      turnID: String(context.turnID ?? ""),
      messageID: String(context.messageID ?? ""),
      toolCallID: String(context.toolCallID ?? ""),
    },
    scope: {
      kind: "browser-origin",
      sessionID: String(context.sessionID ?? ""),
      extensionInstanceID: String(
        authorizedInput.extensionInstanceID ?? scope.extensionInstanceID ?? "",
      ),
      origin: String(authorizedInput.origin ?? scope.origin ?? ""),
      browserID: typeof authorizedInput.browserID === "string"
        ? authorizedInput.browserID
        : typeof scope.browserID === "string"
          ? scope.browserID
          : undefined,
    },
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
          text: typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult),
        },
      ],
      structuredContent:
        toolResult && typeof toolResult === "object" && !Array.isArray(toolResult)
          ? (toolResult as Record<string, unknown>)
          : undefined,
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
  private client?: AnyboxMcpSdkClient
  private closed = false
  private initializePromise?: Promise<void>
  private readonly options: McpClientOptions
  private readonly stderrLines: string[] = []
  private readonly pluginCapabilityGrants = new Map<string, PluginCapabilityGrant>()
  private stderrStream?: Stream | null
  private transport?: StdioClientTransport | StreamableHTTPClientTransport

  constructor(options: McpClientOptions) {
    this.options = options
  }

  async dispose() {
    if (this.closed) return
    this.closed = true

    const closeTasks: Promise<unknown>[] = []
    if (this.transport instanceof StreamableHTTPClientTransport && this.transport.sessionId) {
      closeTasks.push(this.transport.terminateSession().catch(() => undefined))
    }

    if (this.client) {
      closeTasks.push(this.client.close().catch(() => undefined))
    } else if (this.transport) {
      closeTasks.push(this.transport.close().catch(() => undefined))
    }

    await Promise.allSettled(closeTasks)
    this.stderrStream?.removeAllListeners()
    this.stderrStream = undefined
    this.transport = undefined
    this.client = undefined
    this.initializePromise = undefined
    this.pluginCapabilityGrants.clear()
  }

  async listTools(): Promise<McpToolDefinition[]> {
    await this.ensureInitialized()
    const tools: McpToolDefinition[] = []
    let cursor: string | undefined

    do {
      const result = await this.client!.listTools(cursor ? { cursor } : undefined, {
        timeout: this.options.requestTimeoutMs,
      })
      tools.push(...(result.tools as McpToolDefinition[]))
      cursor = result.nextCursor
    } while (cursor)

    return tools
  }

  async listResources(): Promise<Resource[]> {
    await this.ensureInitialized()
    const resources: Resource[] = []
    let cursor: string | undefined

    do {
      const result = await this.client!.listResources(cursor ? { cursor } : undefined, {
        timeout: this.options.requestTimeoutMs,
      })
      resources.push(...result.resources)
      cursor = result.nextCursor
    } while (cursor)

    return resources
  }

  async listResourceTemplates(): Promise<ResourceTemplate[]> {
    await this.ensureInitialized()
    const resourceTemplates: ResourceTemplate[] = []
    let cursor: string | undefined

    do {
      const result = await this.client!.listResourceTemplates(cursor ? { cursor } : undefined, {
        timeout: this.options.requestTimeoutMs,
      })
      resourceTemplates.push(...result.resourceTemplates)
      cursor = result.nextCursor
    } while (cursor)

    return resourceTemplates
  }

  async readResource(uri: string, abort?: AbortSignal): Promise<ReadResourceResult> {
    await this.ensureInitialized()

    return await this.client!.readResource(
      {
        uri,
      },
      {
        signal: abort,
        timeout: this.options.requestTimeoutMs,
      },
    )
  }

  async callTool(
    toolName: string,
    args: Record<string, unknown> | undefined,
    abort?: AbortSignal,
    context?: McpToolRequestContext,
  ): Promise<McpToolCallResult> {
    await this.ensureInitialized()
    const requestContext = normalizedRequestContext(context)
    const completeContext = completeRequestContext(context)
    const pluginCapabilityToken =
      isAnyboxNodeReplServer(this.options.server)
      && toolName === "js"
      && completeContext
      && this.options.onPluginCapabilityCall
        ? randomBytes(32).toString("base64url")
        : undefined
    if (pluginCapabilityToken && completeContext) {
      this.pluginCapabilityGrants.set(pluginCapabilityToken, {
        context: completeContext,
        signal: abort,
        mutationClaimed: false,
      })
    }
    const requestMeta = isAnyboxNodeReplServer(this.options.server)
      ? requestContext || pluginCapabilityToken
        ? {
            ...(requestContext ?? {}),
            ...(pluginCapabilityToken
              ? { "anybox/pluginCapabilityToken": pluginCapabilityToken }
              : {}),
          } as Record<string, unknown>
        : undefined
      : undefined

    try {
      return normalizeCallResult(await this.client!.callTool(
        {
          name: toolName,
          arguments: args,
          ...(requestMeta ? { _meta: requestMeta } : {}),
        },
        undefined,
        {
          signal: abort,
          timeout: isAnyboxNodeReplServer(this.options.server)
            ? Math.max(this.options.requestTimeoutMs, 250_000)
            : this.options.requestTimeoutMs,
        },
      ))
    } finally {
      if (pluginCapabilityToken) {
        this.pluginCapabilityGrants.delete(pluginCapabilityToken)
      }
    }
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
    await this.ensureInitialized()
    await this.client!.notification({
      method: "notifications/anybox/lifecycle",
      params: input,
    } as never)
  }

  private async ensureInitialized() {
    if (this.initializePromise) return this.initializePromise

    const promise = (async () => {
      if (this.closed) {
        throw new Error(`MCP server '${this.options.server.id}' is closed.`)
      }

      const client = new Client<PluginCapabilityRequest, Notification, PluginCapabilityResult>(
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
        },
      )

      client.setRequestHandler(ListRootsRequestSchema, async () => ({
        roots: [this.options.cwd, this.options.worktree]
          .filter((value, index, all) => value && all.indexOf(value) === index)
          .map((value) => ({
            uri: pathToFileURL(value).toString(),
            name: value === this.options.cwd ? "cwd" : "worktree",
          })),
      }))
      if (isAnyboxNodeReplServer(this.options.server)) {
        client.setRequestHandler(
          ElicitRequestSchema,
          this.options.onElicitation ?? handleAnyboxPermissionElicitation,
        )
        if (this.options.onPluginCapabilityCall) {
          client.setRequestHandler(
            PluginCapabilityRequestSchema,
            async (request) => await this.handlePluginCapabilityCall(request),
          )
        }
      }
      const transport = await this.createTransport()
      transport.onerror = (error) => {
        if (this.closed) return
        log.warn("mcp transport error", {
          serverID: this.options.server.id,
          error: error instanceof Error ? error.message : String(error),
          detail: this.stderrLines.at(-1),
        })
      }
      transport.onclose = () => {
        if (this.closed) return
        this.client = undefined
        this.transport = undefined
        this.initializePromise = undefined
        log.warn("mcp transport closed", {
          serverID: this.options.server.id,
          detail: this.stderrLines.at(-1),
        })
      }

      this.transport = transport
      this.client = client
      await client.connect(transport, {
        timeout: this.options.requestTimeoutMs,
      })
    })().catch(async (error) => {
      const detail = this.stderrHint()
      await this.disposeTransport()
      this.client = undefined
      this.transport = undefined
      this.initializePromise = undefined

      if (error instanceof Error && detail) {
        throw new Error(`${error.message}${detail}`)
      }

      throw error
    })

    this.initializePromise = promise
    return await promise
  }

  private async handlePluginCapabilityCall(
    request: PluginCapabilityRequest,
  ): Promise<PluginCapabilityResult> {
    const failure = (error: unknown): PluginCapabilityResult => {
      const message = error instanceof Error ? error.message : String(error)
      const code = error && typeof error === "object" && "code" in error
        && typeof error.code === "string"
        ? error.code
        : "PLUGIN_CAPABILITY_DENIED"
      return {
        content: [{ type: "text", text: message }],
        structuredContent: { error: message, code },
        isError: true,
      }
    }

    try {
      const handler = this.options.onPluginCapabilityCall
      if (!handler) {
        throw Object.assign(new Error("Plugin capability calls are not enabled for this Node REPL."), {
          code: "PLUGIN_CAPABILITY_DISABLED",
        })
      }
      const grant = this.pluginCapabilityGrants.get(request.params.token)
      if (!grant) {
        throw Object.assign(new Error("The plugin capability grant is missing or expired."), {
          code: "PLUGIN_CAPABILITY_EXPIRED",
        })
      }
      for (const key of ["sessionID", "turnID", "messageID", "toolCallID"] as const) {
        if (request.params.context[key] !== grant.context[key]) {
          throw Object.assign(new Error("The plugin capability context does not match the active JavaScript call."), {
            code: "PLUGIN_CAPABILITY_CONTEXT_MISMATCH",
          })
        }
      }

      const result = await handler({
        capability: request.params.capability,
        operation: request.params.operation,
        arguments: request.params.arguments,
        context: grant.context,
        signal: grant.signal,
        claimMutation: () => {
          if (grant.mutationClaimed) {
            throw Object.assign(
              new Error("Only one state-changing plugin capability operation is allowed per JavaScript call."),
              { code: "PLUGIN_CAPABILITY_MUTATION_LIMIT" },
            )
          }
          grant.mutationClaimed = true
        },
      })
      return { ...result } as PluginCapabilityResult
    } catch (error) {
      return failure(error)
    }
  }

  private async disposeTransport() {
    this.stderrStream?.removeAllListeners()
    this.stderrStream = undefined
    if (!this.transport) return
    await this.transport.close().catch(() => undefined)
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
  return {
    text: text || JSON.stringify(result.structuredContent ?? result.content),
    isError: result.isError ?? false,
  }
}

export function getMcpToolDisplayName(server: McpServerSummary, tool: McpToolDefinition) {
  return `${server.name ?? server.id}/${getToolDisplayName(tool)}`
}
