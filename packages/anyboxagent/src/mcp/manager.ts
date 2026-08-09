import os from "node:os"
import { isAbsolute, resolve as resolvePath } from "node:path"
import type { JSONValue } from "@ai-sdk/provider"
import {
  fromJsonSchema,
  isSpecType,
  type JsonSchemaType,
} from "@modelcontextprotocol/client"
import z from "zod"
import * as Config from "#config/config.ts"
import {
  isNodeReplServer,
  NODE_REPL_SERVER_ID,
} from "#mcp/builtin.ts"
import { Instance } from "#project/instance.ts"
import * as Tool from "#tool/tool.ts"
import * as EventStore from "#session/runtime/event-store.ts"
import * as Log from "#util/log.ts"
import {
  McpClient,
  type McpClientLike,
  type McpResourceDefinition,
  type McpResourceReadResult,
  type McpResourceTemplateDefinition,
  type McpToolCallResult,
  type McpToolDefinition,
  getMcpToolDisplayName,
  summarizeToolCallResult,
} from "#mcp/client.ts"

const log = Log.create({ service: "mcp.manager" })

type ManagedServer = {
  client?: McpClientLike
  config: Config.McpServerSummary
  configKey: string
  consecutiveFailures?: number
  circuitOpenUntil?: number
  lastFailure?: string
  resourcesCache?: McpResourceDefinition[]
  resourcesPromise?: Promise<McpResourceDefinition[]>
  resourcesNeedRefresh?: boolean
  resourceTemplatesCache?: McpResourceTemplateDefinition[]
  resourceTemplatesPromise?: Promise<McpResourceTemplateDefinition[]>
  resourceTemplatesNeedRefresh?: boolean
  toolsCache?: McpToolDefinition[]
  toolsDiscoveryDeferred?: boolean
  toolsPromise?: Promise<McpToolDefinition[]>
  toolsNeedRefresh?: boolean
}

export interface McpServerDiagnostic {
  serverID: string
  enabled: boolean
  ok: boolean
  toolCount: number
  toolNames: string[]
  tools: McpToolDiagnostic[]
  error?: string
}

export interface McpToolDiagnostic {
  name: string
  title?: string
  displayName: string
  description?: string
  inputSchema?: unknown
  annotations?: McpToolDefinition["annotations"]
  riskHint: "read-only" | "destructive" | "open-world" | "unknown"
  recommendedPolicy: Config.McpToolPolicyValue
  configuredPolicy?: Config.McpToolPolicyValue
}

export interface McpResourceListItem {
  serverID: string
  serverName: string
  resource: McpResourceDefinition
}

export interface McpResourceTemplateListItem {
  serverID: string
  serverName: string
  resourceTemplate: McpResourceTemplateDefinition
}

export interface McpResourceListError {
  serverID: string
  serverName: string
  error: string
}

export interface McpResourceListResult {
  items: McpResourceListItem[]
  errors: McpResourceListError[]
}

export interface McpResourceTemplateListResult {
  items: McpResourceTemplateListItem[]
  errors: McpResourceListError[]
}

export interface McpReadResourceResult {
  serverID: string
  serverName: string
  uri: string
  contents: McpResourceReadResult["contents"]
  meta?: McpResourceReadResult["_meta"]
}

const MCP_STRUCTURED_CONTENT_KEY = "mcpStructuredContent"
const MCP_IS_ERROR_KEY = "mcpIsError"
const MCP_SERVER_ID_KEY = "serverID"
const MCP_TOOL_NAME_KEY = "toolName"
const GLOBAL_MCP_WORKDIR = os.homedir()
const MCP_CIRCUIT_BREAKER_BASE_MS = 2_000
const MCP_CIRCUIT_BREAKER_MAX_MS = 30_000
const MCP_INITIAL_TOOL_DISCOVERY_WAIT_MS = 2_000
const MCP_TOOL_DISCOVERY_PENDING = Symbol("mcp-tool-discovery-pending")

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function throwIfAborted(abort?: AbortSignal) {
  if (!abort?.aborted) return
  if (abort.reason instanceof Error) throw abort.reason
  const error = new Error(
    typeof abort.reason === "string" && abort.reason.trim()
      ? abort.reason
      : "MCP request aborted.",
  )
  error.name = "AbortError"
  throw error
}

function isCancellationError(error: unknown) {
  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    return error.name === "AbortError" || message.includes("abort") || message.includes("cancel")
  }
  return false
}

function normalizeIdentifier(value: string) {
  return Tool.toModelToolName(value)
}

function canonicalToolID(serverID: string, toolName: string) {
  return `mcp__${normalizeIdentifier(serverID)}__${normalizeIdentifier(toolName)}`
}

function jsonSchemaToZod(schema: unknown): z.ZodTypeAny {
  if (!isRecord(schema)) {
    return z.any()
  }

  try {
    const standardSchema = fromJsonSchema(schema as JsonSchemaType)
    const result = z.unknown().superRefine((value, context) => {
      let validation: ReturnType<typeof standardSchema["~standard"]["validate"]>
      try {
        validation = standardSchema["~standard"].validate(value)
      } catch (error) {
        context.addIssue({
          code: "custom",
          message: error instanceof Error
            ? `Invalid MCP tool input schema: ${error.message}`
            : "Invalid MCP tool input schema.",
        })
        return
      }
      if (validation instanceof Promise) {
        context.addIssue({
          code: "custom",
          message: "Asynchronous MCP JSON Schema validation is not supported.",
        })
        return
      }

      if (validation.issues?.length) {
        context.addIssue({
          code: "custom",
          message: validation.issues.map((issue) => issue.message).join("; "),
        })
      }
    })

    return typeof schema.description === "string" && schema.description.trim()
      ? result.describe(schema.description.trim())
      : result
  } catch (error) {
    log.warn("failed to compile mcp tool input schema", {
      error: error instanceof Error ? error.message : String(error),
    })
    return z.unknown().refine(
      () => false,
      "MCP tool input schema could not be compiled.",
    )
  }
}

function toolCapabilities(tool: McpToolDefinition): Tool.ToolCapabilities {
  const readOnly = tool.annotations?.readOnlyHint ?? false
  const destructive =
    readOnly ? false : tool.annotations?.destructiveHint === undefined ? false : tool.annotations.destructiveHint

  return {
    kind: readOnly ? (tool.annotations?.openWorldHint ? "search" : "read") : "other",
    readOnly,
    destructive,
  }
}

function toAttachments(result: McpToolCallResult): Tool.ToolAttachment[] | undefined {
  const attachments: Tool.ToolAttachment[] = []

  for (const block of result.content) {
    if (!block || typeof block !== "object") continue
    const record = block as Record<string, unknown>

    if (record.type === "image" && typeof record.data === "string" && typeof record.mimeType === "string") {
      attachments.push({
        url: `data:${record.mimeType};base64,${record.data}`,
        mime: record.mimeType,
      })
      continue
    }

    if (record.type === "audio" && typeof record.data === "string" && typeof record.mimeType === "string") {
      attachments.push({
        url: `data:${record.mimeType};base64,${record.data}`,
        mime: record.mimeType,
      })
      continue
    }

    if (record.type === "resource" && record.resource && typeof record.resource === "object") {
      const resource = record.resource as Record<string, unknown>
      if (typeof resource.blob === "string" && typeof resource.mimeType === "string") {
        attachments.push({
          url: `data:${resource.mimeType};base64,${resource.blob}`,
          mime: resource.mimeType,
          filename: typeof resource.uri === "string" ? resource.uri.split("/").pop() : undefined,
        })
      }
    }
  }

  return attachments.length > 0 ? attachments : undefined
}

export class McpManager {
  private readonly handles = new Map<string, ManagedServer>()
  private readonly projectID: string
  private readonly unsubscribeLifecycle: () => void

  constructor(projectID: string) {
    this.projectID = projectID
    this.unsubscribeLifecycle = EventStore.subscribe((event) => {
      if (
        event.type !== "turn.completed"
        && event.type !== "turn.failed"
        && event.type !== "turn.cancelled"
      ) {
        return
      }
      if (!event.turnID) return
      const client = this.handles.get(NODE_REPL_SERVER_ID)?.client
      if (!client) return
      void client.notifyLifecycle({
        type: "turn-end",
        context: {
          sessionID: event.sessionID,
          turnID: event.turnID,
        },
        detail: {
          terminalEvent: event.type,
        },
      }).catch((error) => {
        log.warn("failed to notify node repl lifecycle", {
          sessionID: event.sessionID,
          turnID: event.turnID,
          error: error instanceof Error ? error.message : String(error),
        })
      })
    })
  }

  async dispose() {
    this.unsubscribeLifecycle()
    await Promise.all(Array.from(this.handles.values()).map((handle) => handle.client?.dispose()))
    this.handles.clear()
  }

  async notifyNodeReplLifecycleIfConnected(input: {
    type: string
    context: {
      sessionID: string
      turnID: string
    }
    detail?: Record<string, unknown>
  }) {
    const client = this.handles.get(NODE_REPL_SERVER_ID)?.client
    if (!client) return false
    await client.notifyLifecycle(input)
    return true
  }

  async tools(abort?: AbortSignal): Promise<Tool.ToolInfo[]> {
    throwIfAborted(abort)
    const servers = await Config.resolveDiscoverableProjectMcpServers(this.projectID)
    throwIfAborted(abort)
    await this.reconcile(servers)
    throwIfAborted(abort)
    const result: Tool.ToolInfo[] = []
    const seen = new Map<string, string>()

    const discovered = await Promise.all(servers.map(async (server) => {
      if (!server.enabled) return undefined
      const handle = this.handles.get(server.id)
      if (!handle) return undefined

      try {
        return {
          server,
          tools: this.filterTools(server, await this.serverTools(handle, abort)),
        }
      } catch (error) {
        if (abort?.aborted) throw error
        log.warn("failed to list mcp tools", {
          projectID: this.projectID,
          serverID: server.id,
          error: error instanceof Error ? error.message : String(error),
        })
        return undefined
      }
    }))
    throwIfAborted(abort)

    for (const entry of discovered) {
      if (!entry) continue
      for (const toolDefinition of entry.tools) {
        const id = canonicalToolID(entry.server.id, toolDefinition.name)
        const existing = seen.get(id)
        if (existing) {
          throw new Error(`Duplicate MCP tool id '${id}' from '${existing}' and '${entry.server.id}'.`)
        }
        seen.set(id, entry.server.id)
        result.push(this.createToolInfo(entry.server, toolDefinition, id))
      }
    }

    return result
  }

  async listResources(serverID?: string, abort?: AbortSignal): Promise<McpResourceListResult> {
    throwIfAborted(abort)
    const scopedServers = await this.activeResourceServers(serverID)
    throwIfAborted(abort)
    const result: McpResourceListResult = {
      items: [],
      errors: [],
    }

    for (const { server, handle } of scopedServers) {
      try {
        const resources = await this.serverResources(handle, abort)
        result.items.push(...resources.map((resource) => ({
          serverID: server.id,
          serverName: server.name ?? server.id,
          resource,
        })))
      } catch (error) {
        if (abort?.aborted) throw error
        if (serverID) throw error
        result.errors.push(resourceListError(server, error))
      }
    }

    return result
  }

  async listResourceTemplates(serverID?: string, abort?: AbortSignal): Promise<McpResourceTemplateListResult> {
    throwIfAborted(abort)
    const scopedServers = await this.activeResourceServers(serverID)
    throwIfAborted(abort)
    const result: McpResourceTemplateListResult = {
      items: [],
      errors: [],
    }

    for (const { server, handle } of scopedServers) {
      try {
        const resourceTemplates = await this.serverResourceTemplates(handle, abort)
        result.items.push(...resourceTemplates.map((resourceTemplate) => ({
          serverID: server.id,
          serverName: server.name ?? server.id,
          resourceTemplate,
        })))
      } catch (error) {
        if (abort?.aborted) throw error
        if (serverID) throw error
        result.errors.push(resourceListError(server, error))
      }
    }

    return result
  }

  async readResource(
    serverID: string,
    uri: string,
    abort?: AbortSignal,
  ): Promise<McpReadResourceResult> {
    throwIfAborted(abort)
    const scopedServers = await this.activeResourceServers(serverID)
    throwIfAborted(abort)
    const entry = scopedServers[0]
    if (!entry) {
      throw new Error(`MCP server '${serverID}' is not available for project '${this.projectID}'.`)
    }

    this.throwIfCircuitOpen(entry.handle)
    const client = await this.clientFor(entry.handle)
    const result = await client.readResource(uri, abort)
    this.markHealthy(entry.handle)

    return {
      serverID: entry.server.id,
      serverName: entry.server.name ?? entry.server.id,
      uri,
      contents: result.contents,
      meta: result._meta,
    }
  }

  async diagnose(serverID: string): Promise<McpServerDiagnostic> {
    const activeServers = await Config.resolveDiscoverableProjectMcpServers(this.projectID)
    const server = await Config.getProjectMcpServer(this.projectID, serverID)
    if (!server) {
      throw new Error(`MCP server '${serverID}' is not available for project '${this.projectID}'.`)
    }

    const serversToReconcile = activeServers.some((item) => item.id === server.id)
      ? activeServers
      : [...activeServers, server]
    await this.reconcile(serversToReconcile)

    if (!server.enabled) {
      return {
        serverID,
        enabled: false,
        ok: false,
        toolCount: 0,
        toolNames: [],
        tools: [],
        error: "Server is disabled.",
      }
    }

    const handle = this.handles.get(server.id)
    if (!handle) {
      return {
        serverID,
        enabled: true,
        ok: false,
        toolCount: 0,
        toolNames: [],
        tools: [],
        error: "Server handle is unavailable.",
      }
    }

    try {
      const listedTools = await this.serverTools(handle)
      const tools = this.filterTools(server, listedTools)
      return {
        serverID,
        enabled: true,
        ok: true,
        toolCount: tools.length,
        toolNames: tools.map((tool) => tool.name),
        tools: listedTools.map((tool) => mcpToolDiagnostic(server, tool)),
      }
    } catch (error) {
      return {
        serverID,
        enabled: true,
        ok: false,
        toolCount: 0,
        toolNames: [],
        tools: [],
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private async reconcile(servers: Config.McpServerSummary[]) {
    const nextKeys = new Set<string>()

    for (const server of servers) {
      const key = JSON.stringify(server)
      nextKeys.add(server.id)
      const existing = this.handles.get(server.id)
      if (existing && existing.configKey === key) {
        continue
      }

      await existing?.client?.dispose()
      this.handles.set(server.id, {
        config: server,
        configKey: key,
      })
    }

    for (const [serverID, handle] of this.handles.entries()) {
      if (nextKeys.has(serverID)) continue
      await handle.client?.dispose()
      this.handles.delete(serverID)
    }
  }

  private async activeResourceServers(serverID?: string) {
    const [servers, discoverableServers] = await Promise.all([
      Config.resolveProjectMcpServers(this.projectID),
      Config.resolveDiscoverableProjectMcpServers(this.projectID),
    ])
    await this.reconcile(discoverableServers)

    const requestedServerID = serverID?.trim()
    const scopedServers = requestedServerID
      ? servers.filter((server) => server.id === requestedServerID)
      : servers.filter((server) => server.enabled)

    if (requestedServerID && scopedServers.length === 0) {
      throw new Error(`MCP server '${requestedServerID}' is not available for project '${this.projectID}'.`)
    }

    return scopedServers.map((server) => {
      if (!server.enabled) {
        throw new Error(`MCP server '${server.id}' is disabled.`)
      }

      const handle = this.handles.get(server.id)
      if (!handle) {
        throw new Error(`MCP server '${server.id}' is not configured for project '${this.projectID}'.`)
      }

      return {
        server,
        handle,
      }
    })
  }

  private createToolInfo(server: Config.McpServerSummary, definition: McpToolDefinition, id: string): Tool.ToolInfo {
    const parameters = jsonSchemaToZod(
      definition.inputSchema && typeof definition.inputSchema === "object"
        ? definition.inputSchema
        : { type: "object", additionalProperties: true },
    )
    const policy = effectiveToolPolicy(server, definition)

    return Tool.define(
      id,
      async () => {
        const displayName = getMcpToolDisplayName(server, definition)
        const runtime: Tool.ToolRuntime<typeof parameters> = {
          title: displayName,
          description: definition.description ?? `${definition.name} (from MCP server ${server.name ?? server.id})`,
          parameters,
          execute: async (args, ctx) => {
            const result = await this.call(
              server.id,
              definition.name,
              args as Record<string, unknown>,
              ctx.abort,
              ctx,
            )
            const summary = summarizeToolCallResult(result)
            const hasStructuredContent = result.structuredContent !== undefined
              && isSpecType.JSONValue(result.structuredContent)
            const metadata: Record<string, unknown> = {
              [MCP_SERVER_ID_KEY]: server.id,
              [MCP_TOOL_NAME_KEY]: definition.name,
              [MCP_IS_ERROR_KEY]: summary.isError,
            }

            if (hasStructuredContent) {
              metadata[MCP_STRUCTURED_CONTENT_KEY] = result.structuredContent
            }

            return {
              title: displayName,
              text: summary.text,
              metadata,
              data: hasStructuredContent
                ? {
                    structuredContent: result.structuredContent,
                    isError: summary.isError,
                  }
                : undefined,
              attachments: toAttachments(result),
            }
          },
          toModelOutput: (output) => {
            const metadata = isRecord(output.metadata) ? output.metadata : undefined
            const data = isRecord(output.data) ? output.data : undefined
            const metadataValue = metadata?.[MCP_STRUCTURED_CONTENT_KEY]
            const dataValue = data?.structuredContent
            const structuredContent = isSpecType.JSONValue(metadataValue)
              ? metadataValue
              : isSpecType.JSONValue(dataValue)
                ? dataValue
                : undefined
            const hasStructuredContent = structuredContent !== undefined
            const isError = Boolean(metadata?.[MCP_IS_ERROR_KEY] ?? data?.isError)

            if (hasStructuredContent) {
              if (isError) {
                return {
                  type: "error-json" as const,
                  value: structuredContent as JSONValue,
                }
              }

              return {
                type: "json" as const,
                value: structuredContent as JSONValue,
              }
            }

            if (isError) {
              return {
                type: "error-text" as const,
                value: output.text,
              }
            }

            return {
              type: "text" as const,
              value: output.text,
            }
          },
        }

        if (policy) {
          runtime.assessPermission = async (_args, ctx) => ({
              action: policy === "disabled" ? "deny" : policy === "auto" ? "allow" : "ask",
              risk: mcpToolPermissionRisk(definition),
              reason: mcpToolPolicyReason(server, definition, policy),
              forceAsk: policy === "ask" ? true : undefined,
              resource: {
                workdir: ctx.cwd,
                body: `MCP server: ${server.name ?? server.id}\nTool: ${definition.name}`,
              },
            })
          runtime.describeApproval = async (args, ctx) => ({
              title: displayName,
              summary: `Run MCP tool ${definition.name} from ${server.name ?? server.id}.`,
              details: {
                workdir: ctx.cwd,
                body: summarizeMcpToolArguments(args as Record<string, unknown>),
              },
          })
        }

        return runtime
      },
      {
        title: getMcpToolDisplayName(server, definition),
        description: definition.description ?? `${definition.name} (from MCP server ${server.name ?? server.id})`,
        capabilities: toolCapabilities(definition),
        source: {
          kind: "mcp",
          id: server.id,
          name: server.name ?? server.id,
          description:
            server.transport === "remote" || server.transport === "connector"
              ? server.serverDescription
              : undefined,
        },
        inputSchema: isRecord(definition.inputSchema)
          ? definition.inputSchema
          : {
              type: "object",
              additionalProperties: true,
            },
      },
    )
  }

  private async call(
    serverID: string,
    toolName: string,
    args: Record<string, unknown>,
    abort?: AbortSignal,
    context?: Pick<Tool.Context, "sessionID" | "turnID" | "messageID" | "toolCallID">,
  ) {
    const handle = this.handles.get(serverID)
    if (!handle) {
      throw new Error(`MCP server '${serverID}' is not configured for project '${this.projectID}'.`)
    }

    throwIfAborted(abort)
    this.throwIfCircuitOpen(handle)
    const client = await this.clientFor(handle)
    const result = await client.callTool(toolName, args, abort, context)
    this.markHealthy(handle)
    return result
  }

  private async serverTools(
    handle: ManagedServer,
    abort?: AbortSignal,
  ): Promise<McpToolDefinition[]> {
    throwIfAborted(abort)
    if (handle.toolsCache && !handle.toolsNeedRefresh) return handle.toolsCache
    if (handle.toolsCache) {
      if (!this.isCircuitOpen(handle) && !handle.toolsPromise) {
        void this.refreshTools(handle).catch((error) => {
          log.warn("failed to refresh stale mcp tool cache", {
            projectID: this.projectID,
            serverID: handle.config.id,
            error: error instanceof Error ? error.message : String(error),
          })
        })
      }
      return handle.toolsCache
    }
    this.throwIfCircuitOpen(handle)
    if (handle.toolsPromise && handle.toolsDiscoveryDeferred) return []

    const promise = this.refreshTools(handle, abort)
    let timer: ReturnType<typeof setTimeout> | undefined
    const pending = new Promise<typeof MCP_TOOL_DISCOVERY_PENDING>((resolve) => {
      timer = setTimeout(
        () => resolve(MCP_TOOL_DISCOVERY_PENDING),
        MCP_INITIAL_TOOL_DISCOVERY_WAIT_MS,
      )
      timer.unref?.()
    })
    let result: McpToolDefinition[] | typeof MCP_TOOL_DISCOVERY_PENDING
    try {
      result = await Promise.race([promise, pending])
    } finally {
      if (timer) clearTimeout(timer)
    }
    if (result !== MCP_TOOL_DISCOVERY_PENDING) return result

    handle.toolsDiscoveryDeferred = true
    void promise.catch((error) => {
      log.warn("deferred mcp tool discovery failed", {
        projectID: this.projectID,
        serverID: handle.config.id,
        error: error instanceof Error ? error.message : String(error),
      })
    })
    log.warn("mcp tool discovery exceeded the foreground budget", {
      projectID: this.projectID,
      serverID: handle.config.id,
      waitMs: MCP_INITIAL_TOOL_DISCOVERY_WAIT_MS,
    })
    return handle.toolsCache ?? []
  }

  private async refreshTools(
    handle: ManagedServer,
    abort?: AbortSignal,
  ): Promise<McpToolDefinition[]> {
    const promise = handle.toolsPromise ?? (async () => {
      const client = await this.clientFor(handle)
      try {
        const result = await client.listTools(abort)
        handle.toolsCache = result
        handle.toolsNeedRefresh = false
        this.markHealthy(handle)
        return result
      } catch (error) {
        if (handle.client === client && !isCancellationError(error)) {
          this.recordFailure(handle, error)
        }
        throw error
      }
    })()
    handle.toolsPromise = promise
    try {
      return await promise
    } finally {
      if (handle.toolsPromise === promise) {
        handle.toolsPromise = undefined
        handle.toolsDiscoveryDeferred = false
      }
    }
  }

  private async serverResources(
    handle: ManagedServer,
    abort?: AbortSignal,
  ): Promise<McpResourceDefinition[]> {
    throwIfAborted(abort)
    if (handle.resourcesCache && !handle.resourcesNeedRefresh) return handle.resourcesCache
    if (handle.resourcesCache && this.isCircuitOpen(handle)) return handle.resourcesCache
    this.throwIfCircuitOpen(handle)
    const promise = handle.resourcesPromise ?? (async () => {
      const client = await this.clientFor(handle)
      try {
        const result = await client.listResources(abort)
        handle.resourcesCache = result
        handle.resourcesNeedRefresh = false
        this.markHealthy(handle)
        return result
      } catch (error) {
        if (handle.client === client && !isCancellationError(error)) {
          this.recordFailure(handle, error)
        }
        if (handle.resourcesCache) return handle.resourcesCache
        throw error
      }
    })()
    handle.resourcesPromise = promise
    try {
      return await promise
    } finally {
      if (handle.resourcesPromise === promise) {
        handle.resourcesPromise = undefined
      }
    }
  }

  private async serverResourceTemplates(
    handle: ManagedServer,
    abort?: AbortSignal,
  ): Promise<McpResourceTemplateDefinition[]> {
    throwIfAborted(abort)
    if (handle.resourceTemplatesCache && !handle.resourceTemplatesNeedRefresh) {
      return handle.resourceTemplatesCache
    }
    if (handle.resourceTemplatesCache && this.isCircuitOpen(handle)) {
      return handle.resourceTemplatesCache
    }
    this.throwIfCircuitOpen(handle)
    const promise = handle.resourceTemplatesPromise
      ?? (async () => {
        const client = await this.clientFor(handle)
        try {
          const result = await client.listResourceTemplates(abort)
          handle.resourceTemplatesCache = result
          handle.resourceTemplatesNeedRefresh = false
          this.markHealthy(handle)
          return result
        } catch (error) {
          if (handle.client === client && !isCancellationError(error)) {
            this.recordFailure(handle, error)
          }
          if (handle.resourceTemplatesCache) return handle.resourceTemplatesCache
          throw error
        }
      })()
    handle.resourceTemplatesPromise = promise
    try {
      return await promise
    } finally {
      if (handle.resourceTemplatesPromise === promise) {
        handle.resourceTemplatesPromise = undefined
      }
    }
  }

  private isCircuitOpen(handle: ManagedServer) {
    return (handle.circuitOpenUntil ?? 0) > Date.now()
  }

  private throwIfCircuitOpen(handle: ManagedServer) {
    if (!this.isCircuitOpen(handle)) return
    const retryAfterMs = Math.max(1, (handle.circuitOpenUntil ?? 0) - Date.now())
    throw new Error(
      `MCP server '${handle.config.id}' is temporarily unavailable after repeated failures. `
      + `Retry after ${retryAfterMs}ms.${handle.lastFailure ? ` Last error: ${handle.lastFailure}` : ""}`,
    )
  }

  private markHealthy(handle: ManagedServer) {
    handle.consecutiveFailures = 0
    handle.circuitOpenUntil = undefined
    handle.lastFailure = undefined
  }

  private recordFailure(handle: ManagedServer, error: unknown) {
    const failures = (handle.consecutiveFailures ?? 0) + 1
    const cooldown = Math.min(
      MCP_CIRCUIT_BREAKER_BASE_MS * 2 ** Math.max(0, failures - 1),
      MCP_CIRCUIT_BREAKER_MAX_MS,
    )
    handle.consecutiveFailures = failures
    handle.circuitOpenUntil = Date.now() + cooldown
    handle.lastFailure = error instanceof Error ? error.message : String(error)
  }

  private handleClientInvalidated(
    handle: ManagedServer,
    client: McpClientLike,
    error: unknown,
  ) {
    if (handle.client !== client) return
    handle.client = undefined
    handle.toolsPromise = undefined
    handle.toolsDiscoveryDeferred = false
    handle.resourcesPromise = undefined
    handle.resourceTemplatesPromise = undefined
    handle.toolsNeedRefresh = true
    handle.resourcesNeedRefresh = true
    handle.resourceTemplatesNeedRefresh = true
    if (!isCancellationError(error)) this.recordFailure(handle, error)
  }

  private async clientFor(handle: ManagedServer): Promise<McpClientLike> {
    if (handle.client) return handle.client

    const timeout = handle.config.timeoutMs ?? (await Config.get(this.projectID)).experimental?.mcp_timeout ?? 30_000
    const client: McpClientLike = new McpClient({
      cwd: handle.config.transport === "stdio" ? resolveServerCwd(handle.config) : Instance.directory,
      onToolsChanged: () => {
        handle.toolsCache = undefined
        handle.toolsPromise = undefined
        handle.toolsDiscoveryDeferred = false
        handle.toolsNeedRefresh = true
      },
      onResourcesChanged: () => {
        handle.resourcesCache = undefined
        handle.resourcesPromise = undefined
        handle.resourcesNeedRefresh = true
        handle.resourceTemplatesCache = undefined
        handle.resourceTemplatesPromise = undefined
        handle.resourceTemplatesNeedRefresh = true
      },
      onInvalidated: (error) => this.handleClientInvalidated(handle, client, error),
      requestTimeoutMs: timeout,
      server: handle.config,
      worktree: Instance.worktree,
    })
    handle.client = client

    return client
  }

  private filterTools(server: Config.McpServerSummary, tools: McpToolDefinition[]) {
    return filterMcpTools(server, tools)
  }
}

function resourceListError(server: Config.McpServerSummary, error: unknown): McpResourceListError {
  return {
    serverID: server.id,
    serverName: server.name ?? server.id,
    error: error instanceof Error ? error.message : String(error),
  }
}

function resolveServerCwd(server: Config.McpServerSummary) {
  const fallbackDirectory = isNodeReplServer(server)
    ? Instance.directory
    : GLOBAL_MCP_WORKDIR
  const configuredCwd = server.transport === "stdio" ? server.cwd : undefined
  return resolveConfiguredCwd(configuredCwd, fallbackDirectory)
}

function expandHomePath(value: string) {
  if (value === "~") return GLOBAL_MCP_WORKDIR
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return resolvePath(GLOBAL_MCP_WORKDIR, value.slice(2))
  }
  return value
}

function resolveConfiguredCwd(cwd: string | undefined, fallbackDirectory: string) {
  const normalized = cwd?.trim()
  if (!normalized) return fallbackDirectory

  const expanded = expandHomePath(normalized)
  if (isAbsolute(expanded)) return expanded
  return resolvePath(fallbackDirectory, expanded)
}

function configuredToolPolicies(server: Config.McpServerSummary) {
  const policies = server.toolPolicies
  return policies && Object.keys(policies).length > 0 ? policies : undefined
}

function configuredToolPolicy(server: Config.McpServerSummary, toolName: string) {
  return configuredToolPolicies(server)?.[toolName]?.policy
}

function recommendedToolPolicy(tool: McpToolDefinition): Config.McpToolPolicyValue {
  return tool.annotations?.readOnlyHint === true && tool.annotations?.destructiveHint !== true ? "auto" : "ask"
}

function effectiveToolPolicy(
  server: Config.McpServerSummary,
  tool: McpToolDefinition,
): Config.McpToolPolicyValue | undefined {
  const policies = configuredToolPolicies(server)
  if (!policies) return undefined
  return policies[tool.name]?.policy ?? "ask"
}

function mcpToolRiskHint(tool: McpToolDefinition): McpToolDiagnostic["riskHint"] {
  if (tool.annotations?.destructiveHint === true) return "destructive"
  if (tool.annotations?.openWorldHint === true) return "open-world"
  if (tool.annotations?.readOnlyHint === true) return "read-only"
  return "unknown"
}

function mcpToolPermissionRisk(tool: McpToolDefinition): Tool.ToolPermissionIntent["risk"] {
  if (tool.annotations?.destructiveHint === true) return "high"
  if (tool.annotations?.readOnlyHint === true && tool.annotations?.openWorldHint !== true) return "low"
  return "medium"
}

function mcpToolPolicyReason(
  server: Config.McpServerSummary,
  tool: McpToolDefinition,
  policy: Config.McpToolPolicyValue,
) {
  const serverName = server.name ?? server.id
  switch (policy) {
    case "disabled":
      return `MCP tool '${tool.name}' from '${serverName}' is disabled by configuration.`
    case "auto":
      return `MCP tool '${tool.name}' from '${serverName}' is auto-allowed by configuration.`
    case "ask":
      return `MCP tool '${tool.name}' from '${serverName}' requires approval by configuration.`
  }
}

function summarizeMcpToolArguments(args: Record<string, unknown>) {
  try {
    const serialized = JSON.stringify(args, null, 2)
    if (!serialized) return undefined
    return serialized.length > 2_000 ? `${serialized.slice(0, 2_000)}...` : serialized
  } catch {
    return undefined
  }
}

function mcpToolDiagnostic(server: Config.McpServerSummary, tool: McpToolDefinition): McpToolDiagnostic {
  return {
    name: tool.name,
    title: tool.title,
    displayName: getMcpToolDisplayName(server, tool),
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
    riskHint: mcpToolRiskHint(tool),
    recommendedPolicy: recommendedToolPolicy(tool),
    configuredPolicy: configuredToolPolicy(server, tool.name),
  }
}

function filterMcpTools(server: Config.McpServerSummary, tools: McpToolDefinition[]) {
  const policies = configuredToolPolicies(server)
  const allowedTools =
    server.transport === "remote" || server.transport === "connector"
      ? server.allowedTools
      : undefined
  const namedTools = new Set(
    Array.isArray(allowedTools)
      ? allowedTools
      : allowedTools?.toolNames ?? [],
  )
  const requireReadOnly = !Array.isArray(allowedTools) && allowedTools?.readOnly === true

  return tools.filter((tool) => {
    if (policies?.[tool.name]?.policy === "disabled") {
      return false
    }

    if (requireReadOnly && tool.annotations?.readOnlyHint !== true) {
      return false
    }

    if (namedTools.size > 0 && !namedTools.has(tool.name)) {
      return false
    }

    return true
  })
}

export async function diagnoseServer(server: Config.McpServerSummary): Promise<McpServerDiagnostic> {
  if (!server.enabled) {
    return {
      serverID: server.id,
      enabled: false,
      ok: false,
      toolCount: 0,
      toolNames: [],
      tools: [],
      error: "Server is disabled.",
    }
  }

  const timeout = server.timeoutMs ?? (await Config.get(Config.GLOBAL_CONFIG_ID)).experimental?.mcp_timeout ?? 30_000
  const cwd = server.transport === "stdio" ? resolveConfiguredCwd(server.cwd, GLOBAL_MCP_WORKDIR) : GLOBAL_MCP_WORKDIR
  const client: McpClientLike = new McpClient({
    cwd,
    requestTimeoutMs: timeout,
    server,
    worktree: cwd,
  })

  try {
    const listedTools = await client.listTools()
    const tools = filterMcpTools(server, listedTools)
    return {
      serverID: server.id,
      enabled: true,
      ok: true,
      toolCount: tools.length,
      toolNames: tools.map((tool) => tool.name),
      tools: listedTools.map((tool) => mcpToolDiagnostic(server, tool)),
    }
  } catch (error) {
    return {
      serverID: server.id,
      enabled: true,
      ok: false,
      toolCount: 0,
      toolNames: [],
      tools: [],
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    await client.dispose()
  }
}

const managerState = Instance.state(
  () => new McpManager(Instance.project.id),
  async (manager) => {
    await manager.dispose()
  },
)

export async function tools(abort?: AbortSignal) {
  return await managerState().tools(abort)
}

export async function notifyNodeReplLifecycleIfConnected(input: {
  type: string
  context: {
    sessionID: string
    turnID: string
  }
  detail?: Record<string, unknown>
}) {
  return managerState().notifyNodeReplLifecycleIfConnected(input)
}

export async function diagnose(serverID: string) {
  return await managerState().diagnose(serverID)
}

export async function listResources(serverID?: string, abort?: AbortSignal) {
  return await managerState().listResources(serverID, abort)
}

export async function listResourceTemplates(serverID?: string, abort?: AbortSignal) {
  return await managerState().listResourceTemplates(serverID, abort)
}

export async function readResource(serverID: string, uri: string, abort?: AbortSignal) {
  return await managerState().readResource(serverID, uri, abort)
}
