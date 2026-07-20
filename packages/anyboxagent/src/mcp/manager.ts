import { isDeepStrictEqual } from "node:util"
import os from "node:os"
import { isAbsolute, resolve as resolvePath } from "node:path"
import type { JSONValue } from "@ai-sdk/provider"
import z from "zod"
import * as Config from "#config/config.ts"
import { NODE_REPL_SERVER_ID } from "#mcp/builtin.ts"
import { Instance } from "#project/instance.ts"
import * as Tool from "#tool/tool.ts"
import * as EventStore from "#session/runtime/event-store.ts"
import * as Log from "#util/log.ts"
import {
  McpClient,
  type McpResourceDefinition,
  type McpResourceReadResult,
  type McpResourceTemplateDefinition,
  type McpToolCallResult,
  type McpToolDefinition,
  getMcpToolDisplayName,
  summarizeToolCallResult,
} from "#mcp/client.ts"

const log = Log.create({ service: "mcp.manager" })

type JsonSchemaObject = Record<string, unknown>

type ManagedServer = {
  client?: McpClient
  config: Config.McpServerSummary
  configKey: string
  resourcesPromise?: Promise<McpResourceDefinition[]>
  resourceTemplatesPromise?: Promise<McpResourceTemplateDefinition[]>
  toolsPromise?: Promise<McpToolDefinition[]>
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

type LiteralValue = string | number | bigint | boolean | null | undefined

const MCP_STRUCTURED_CONTENT_KEY = "mcpStructuredContent"
const MCP_IS_ERROR_KEY = "mcpIsError"
const MCP_SERVER_ID_KEY = "serverID"
const MCP_TOOL_NAME_KEY = "toolName"
const GLOBAL_MCP_WORKDIR = os.homedir()

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function normalizeIdentifier(value: string) {
  return Tool.toModelToolName(value)
}

function canonicalToolID(serverID: string, toolName: string) {
  return `mcp__${normalizeIdentifier(serverID)}__${normalizeIdentifier(toolName)}`
}

function isLiteralValue(value: unknown): value is LiteralValue {
  return value === null || ["string", "number", "bigint", "boolean", "undefined"].includes(typeof value)
}

function literalUnion(values: unknown[]) {
  if (values.length === 0) return z.never()
  if (values.every(isLiteralValue)) {
    const literals = values.map((value) => z.literal(value))
    if (literals.length === 1) return literals[0]!
    return z.union([literals[0]!, literals[1]!, ...literals.slice(2)] as [
      z.ZodLiteral<LiteralValue>,
      z.ZodLiteral<LiteralValue>,
      ...z.ZodLiteral<LiteralValue>[],
    ])
  }

  return z.custom((input) => values.some((value) => isDeepStrictEqual(value, input)))
}

function schemaUnion(options: z.ZodTypeAny[]) {
  if (options.length === 0) return z.any()
  if (options.length === 1) return options[0]!
  return z.union([options[0]!, options[1]!, ...options.slice(2)] as [
    z.ZodTypeAny,
    z.ZodTypeAny,
    ...z.ZodTypeAny[],
  ])
}

function jsonSchemaToZod(schema: unknown): z.ZodTypeAny {
  if (!schema || typeof schema !== "object") {
    return z.any()
  }

  const record = schema as JsonSchemaObject
  if (Array.isArray(record.enum)) {
    return literalUnion(record.enum as unknown[])
  }

  if ("const" in record) {
    return literalUnion([record.const])
  }

  if (Array.isArray(record.anyOf) && record.anyOf.length > 0) {
    return schemaUnion(record.anyOf.map((item) => jsonSchemaToZod(item)))
  }

  if (Array.isArray(record.oneOf) && record.oneOf.length > 0) {
    return schemaUnion(record.oneOf.map((item) => jsonSchemaToZod(item)))
  }

  const typeField = Array.isArray(record.type) ? record.type : typeof record.type === "string" ? [record.type] : []
  const allowsNull = typeField.includes("null")
  const primaryType = typeField.find((value) => value !== "null")

  let result: z.ZodTypeAny
  switch (primaryType) {
    case "string":
      result = z.string()
      break
    case "number":
      result = z.number()
      break
    case "integer":
      result = z.number().int()
      break
    case "boolean":
      result = z.boolean()
      break
    case "array": {
      const itemSchema = jsonSchemaToZod(record.items)
      result = z.array(itemSchema)
      break
    }
    case "object":
    default: {
      const properties = record.properties && typeof record.properties === "object" ? (record.properties as Record<string, unknown>) : {}
      const required = new Set(Array.isArray(record.required) ? (record.required as string[]) : [])
      const shape = Object.fromEntries(
        Object.entries(properties).map(([key, value]) => {
          const child = jsonSchemaToZod(value)
          return [key, required.has(key) ? child : child.optional()]
        }),
      )
      const additionalProperties = record.additionalProperties
      result =
        additionalProperties === false
          ? z.object(shape)
          : z.object(shape).catchall(additionalProperties ? jsonSchemaToZod(additionalProperties) : z.any())
      break
    }
  }

  if (typeof record.description === "string" && record.description.trim()) {
    result = result.describe(record.description.trim())
  }

  if (allowsNull) {
    result = result.nullable()
  }

  return result
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

  async tools(): Promise<Tool.ToolInfo[]> {
    const servers = await Config.resolveDiscoverableProjectMcpServers(this.projectID)
    await this.reconcile(servers)
    const result: Tool.ToolInfo[] = []
    const seen = new Map<string, string>()

    for (const server of servers) {
      if (!server.enabled) continue

      const handle = this.handles.get(server.id)
      if (!handle) continue

      let tools: McpToolDefinition[]
      try {
        tools = this.filterTools(server, await this.serverTools(handle))
      } catch (error) {
        log.warn("failed to list mcp tools", {
          projectID: this.projectID,
          serverID: server.id,
          error: error instanceof Error ? error.message : String(error),
        })
        continue
      }

      for (const toolDefinition of tools) {
        const id = canonicalToolID(server.id, toolDefinition.name)
        const existing = seen.get(id)
        if (existing) {
          throw new Error(`Duplicate MCP tool id '${id}' from '${existing}' and '${server.id}'.`)
        }
        seen.set(id, server.id)
        result.push(this.createToolInfo(server, toolDefinition, id))
      }
    }

    return result
  }

  async listResources(serverID?: string): Promise<McpResourceListResult> {
    const scopedServers = await this.activeResourceServers(serverID)
    const result: McpResourceListResult = {
      items: [],
      errors: [],
    }

    for (const { server, handle } of scopedServers) {
      try {
        const resources = await this.serverResources(handle)
        result.items.push(...resources.map((resource) => ({
          serverID: server.id,
          serverName: server.name ?? server.id,
          resource,
        })))
      } catch (error) {
        if (serverID) throw error
        result.errors.push(resourceListError(server, error))
      }
    }

    return result
  }

  async listResourceTemplates(serverID?: string): Promise<McpResourceTemplateListResult> {
    const scopedServers = await this.activeResourceServers(serverID)
    const result: McpResourceTemplateListResult = {
      items: [],
      errors: [],
    }

    for (const { server, handle } of scopedServers) {
      try {
        const resourceTemplates = await this.serverResourceTemplates(handle)
        result.items.push(...resourceTemplates.map((resourceTemplate) => ({
          serverID: server.id,
          serverName: server.name ?? server.id,
          resourceTemplate,
        })))
      } catch (error) {
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
    const scopedServers = await this.activeResourceServers(serverID)
    const entry = scopedServers[0]
    if (!entry) {
      throw new Error(`MCP server '${serverID}' is not available for project '${this.projectID}'.`)
    }

    const client = await this.clientFor(entry.handle)
    const result = await client.readResource(uri, abort)

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
            const metadata: Record<string, unknown> = {
              [MCP_SERVER_ID_KEY]: server.id,
              [MCP_TOOL_NAME_KEY]: definition.name,
              [MCP_IS_ERROR_KEY]: summary.isError,
            }

            if (isRecord(result.structuredContent)) {
              metadata[MCP_STRUCTURED_CONTENT_KEY] = result.structuredContent
            }

            return {
              title: displayName,
              text: summary.text,
              metadata,
              data: isRecord(result.structuredContent)
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
            const structuredContent = isRecord(metadata?.[MCP_STRUCTURED_CONTENT_KEY])
              ? (metadata[MCP_STRUCTURED_CONTENT_KEY] as Record<string, unknown>)
              : isRecord(data?.structuredContent)
                ? (data.structuredContent as Record<string, unknown>)
                : undefined
            const isError = Boolean(metadata?.[MCP_IS_ERROR_KEY] ?? data?.isError)

            if (structuredContent) {
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

    const client = await this.clientFor(handle)
    return await client.callTool(toolName, args, abort, context)
  }

  private async serverTools(handle: ManagedServer) {
    handle.toolsPromise ??= this.clientFor(handle).then((client) => client.listTools())
    return await handle.toolsPromise
  }

  private async serverResources(handle: ManagedServer) {
    handle.resourcesPromise ??= this.clientFor(handle).then((client) => client.listResources())
    return await handle.resourcesPromise
  }

  private async serverResourceTemplates(handle: ManagedServer) {
    handle.resourceTemplatesPromise ??= this.clientFor(handle).then((client) => client.listResourceTemplates())
    return await handle.resourceTemplatesPromise
  }

  private async clientFor(handle: ManagedServer) {
    if (handle.client) return handle.client

    const timeout = handle.config.timeoutMs ?? (await Config.get(this.projectID)).experimental?.mcp_timeout ?? 30_000
    handle.client = new McpClient({
      cwd: handle.config.transport === "stdio" ? resolveServerCwd(handle.config.cwd) : Instance.directory,
      onToolsChanged: () => {
        handle.toolsPromise = undefined
      },
      onResourcesChanged: () => {
        handle.resourcesPromise = undefined
        handle.resourceTemplatesPromise = undefined
      },
      requestTimeoutMs: timeout,
      server: handle.config,
      worktree: Instance.worktree,
    })

    return handle.client
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

function resolveServerCwd(cwd: string | undefined) {
  return resolveConfiguredCwd(cwd, GLOBAL_MCP_WORKDIR)
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
  const client = new McpClient({
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

export async function tools() {
  return await managerState().tools()
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

export async function listResources(serverID?: string) {
  return await managerState().listResources(serverID)
}

export async function listResourceTemplates(serverID?: string) {
  return await managerState().listResourceTemplates(serverID)
}

export async function readResource(serverID: string, uri: string, abort?: AbortSignal) {
  return await managerState().readResource(serverID, uri, abort)
}
