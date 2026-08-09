import type { JSONValue } from "@ai-sdk/provider"
import z from "zod"
import * as Mcp from "#mcp/manager.ts"
import * as Tool from "#tool/tool.ts"

const ListMcpResourcesParameters = z.object({
  server_id: z.string().trim().min(1).optional().describe("Optional MCP server id to list resources from."),
})

const ReadMcpResourceParameters = z.object({
  server_id: z.string().trim().min(1).describe("MCP server id to read the resource from."),
  uri: z.string().min(1).describe("Resource URI to read."),
})

type ResourceContent = Mcp.McpReadResourceResult["contents"][number]

function isTextContent(content: ResourceContent): content is Extract<ResourceContent, { text: string }> {
  return "text" in content && typeof content.text === "string"
}

function isBlobContent(content: ResourceContent): content is Extract<ResourceContent, { blob: string }> {
  return "blob" in content && typeof content.blob === "string"
}

function estimateBase64Bytes(value: string) {
  const normalized = value.replace(/\s/g, "")
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding)
}

function filenameFromUri(uri: string) {
  try {
    const parsed = new URL(uri)
    const filename = parsed.pathname.split("/").filter(Boolean).at(-1)
    return filename ? decodeURIComponent(filename) : "resource"
  } catch {
    return uri.split(/[\\/]/).filter(Boolean).at(-1) ?? "resource"
  }
}

function summarizeResource(resource: Mcp.McpResourceListItem["resource"]) {
  const label = resource.title ?? resource.name
  const details = [
    resource.mimeType,
    typeof resource.size === "number" ? `${resource.size} bytes` : undefined,
  ].filter(Boolean).join(", ")

  return [
    `- ${label}${details ? ` (${details})` : ""}`,
    `  URI: ${resource.uri}`,
    resource.title && resource.title !== resource.name ? `  Name: ${resource.name}` : undefined,
    resource.description ? `  Description: ${resource.description}` : undefined,
  ].filter(Boolean).join("\n")
}

function summarizeResourceTemplate(template: Mcp.McpResourceTemplateListItem["resourceTemplate"]) {
  const label = template.title ?? template.name
  const details = template.mimeType ? ` (${template.mimeType})` : ""

  return [
    `- ${label}${details}`,
    `  URI template: ${template.uriTemplate}`,
    template.title && template.title !== template.name ? `  Name: ${template.name}` : undefined,
    template.description ? `  Description: ${template.description}` : undefined,
  ].filter(Boolean).join("\n")
}

function groupByServer<T extends { serverID: string; serverName: string }>(items: T[]) {
  const result = new Map<string, { serverID: string; serverName: string; items: T[] }>()

  for (const item of items) {
    const group = result.get(item.serverID) ?? {
      serverID: item.serverID,
      serverName: item.serverName,
      items: [],
    }
    group.items.push(item)
    result.set(item.serverID, group)
  }

  return [...result.values()]
}

function formatResourceList(result: Mcp.McpResourceListResult) {
  const lines = [`MCP resources: ${result.items.length}`]

  for (const group of groupByServer(result.items)) {
    lines.push("", `${group.serverName} (${group.serverID})`)
    lines.push(...group.items.map((item) => summarizeResource(item.resource)))
  }

  if (result.errors.length > 0) {
    lines.push("", "Errors:")
    lines.push(...result.errors.map((error) => `- ${error.serverName} (${error.serverID}): ${error.error}`))
  }

  if (result.items.length === 0 && result.errors.length === 0) {
    lines.push("", "No MCP resources found.")
  }

  return lines.join("\n")
}

function formatResourceTemplateList(result: Mcp.McpResourceTemplateListResult) {
  const lines = [`MCP resource templates: ${result.items.length}`]

  for (const group of groupByServer(result.items)) {
    lines.push("", `${group.serverName} (${group.serverID})`)
    lines.push(...group.items.map((item) => summarizeResourceTemplate(item.resourceTemplate)))
  }

  if (result.errors.length > 0) {
    lines.push("", "Errors:")
    lines.push(...result.errors.map((error) => `- ${error.serverName} (${error.serverID}): ${error.error}`))
  }

  if (result.items.length === 0 && result.errors.length === 0) {
    lines.push("", "No MCP resource templates found.")
  }

  return lines.join("\n")
}

function sanitizeContent(content: ResourceContent) {
  if (isTextContent(content)) {
    return {
      uri: content.uri,
      mimeType: content.mimeType,
      meta: content._meta,
      type: "text" as const,
      text: content.text,
    }
  }

  if (isBlobContent(content)) {
    return {
      uri: content.uri,
      mimeType: content.mimeType,
      meta: content._meta,
      type: "blob" as const,
      blobBytes: estimateBase64Bytes(content.blob),
      blobOmitted: true,
    }
  }

  return content
}

function contentAttachments(contents: ResourceContent[]): Tool.ToolAttachment[] | undefined {
  const attachments: Tool.ToolAttachment[] = []

  for (const content of contents) {
    if (!isBlobContent(content) || !content.mimeType) continue
    attachments.push({
      url: `data:${content.mimeType};base64,${content.blob}`,
      mime: content.mimeType,
      filename: filenameFromUri(content.uri),
    })
  }

  return attachments.length > 0 ? attachments : undefined
}

function formatReadResource(result: Mcp.McpReadResourceResult) {
  const lines = [
    `MCP server: ${result.serverName} (${result.serverID})`,
    `URI: ${result.uri}`,
    `Contents: ${result.contents.length}`,
  ]

  result.contents.forEach((content, index) => {
    lines.push("", `Content ${index + 1}: ${content.uri}`)
    if (content.mimeType) lines.push(`MIME: ${content.mimeType}`)

    if (isTextContent(content)) {
      lines.push("", content.text || "(empty text resource)")
      return
    }

    if (isBlobContent(content)) {
      lines.push(`Blob: ${estimateBase64Bytes(content.blob)} bytes`)
      lines.push("Note: binary resource content was returned as an attachment when a MIME type was provided.")
      return
    }

    lines.push(JSON.stringify(content))
  })

  return lines.join("\n")
}

const mcpResourceCapabilities: Tool.ToolCapabilities = {
  kind: "read",
  readOnly: true,
  destructive: false,
  concurrency: "safe",
}

export const ListMcpResourcesTool = Tool.define(
  "list_mcp_resources",
  async () => ({
    title: "List MCP Resources",
    description: "List resources exposed by enabled MCP servers for the active project.",
    parameters: ListMcpResourcesParameters,
    execute: async (parameters, ctx) => {
      const result = await Mcp.listResources(parameters.server_id, ctx.abort)
      const data = {
        kind: "mcp-resources",
        ...(parameters.server_id ? { serverID: parameters.server_id } : {}),
        resources: result.items,
        errors: result.errors,
      }

      return {
        title: parameters.server_id ? `MCP resources from ${parameters.server_id}` : "MCP resources",
        text: formatResourceList(result),
        metadata: data,
        data,
      }
    },
    toModelOutput: (output) => ({
      type: "json" as const,
      value: (output.data ?? output.metadata ?? { text: output.text }) as JSONValue,
    }),
  }),
  {
    title: "List MCP Resources",
    capabilities: mcpResourceCapabilities,
  },
)

export const ListMcpResourceTemplatesTool = Tool.define(
  "list_mcp_resource_templates",
  async () => ({
    title: "List MCP Resource Templates",
    description: "List parameterized resource templates exposed by enabled MCP servers for the active project.",
    parameters: ListMcpResourcesParameters,
    execute: async (parameters, ctx) => {
      const result = await Mcp.listResourceTemplates(parameters.server_id, ctx.abort)
      const data = {
        kind: "mcp-resource-templates",
        ...(parameters.server_id ? { serverID: parameters.server_id } : {}),
        resourceTemplates: result.items,
        errors: result.errors,
      }

      return {
        title: parameters.server_id ? `MCP resource templates from ${parameters.server_id}` : "MCP resource templates",
        text: formatResourceTemplateList(result),
        metadata: data,
        data,
      }
    },
    toModelOutput: (output) => ({
      type: "json" as const,
      value: (output.data ?? output.metadata ?? { text: output.text }) as JSONValue,
    }),
  }),
  {
    title: "List MCP Resource Templates",
    capabilities: mcpResourceCapabilities,
  },
)

export const ReadMcpResourceTool = Tool.define(
  "read_mcp_resource",
  async () => ({
    title: "Read MCP Resource",
    description: "Read a resource URI from a specific enabled MCP server for the active project.",
    parameters: ReadMcpResourceParameters,
    execute: async (parameters, ctx) => {
      const result = await Mcp.readResource(parameters.server_id, parameters.uri, ctx.abort)
      const sanitizedContents = result.contents.map(sanitizeContent)
      const data = {
        kind: "mcp-resource",
        serverID: result.serverID,
        serverName: result.serverName,
        uri: result.uri,
        contents: sanitizedContents,
        meta: result.meta,
      }

      return {
        title: `Read MCP resource ${parameters.uri}`,
        text: formatReadResource(result),
        metadata: data,
        data,
        attachments: contentAttachments(result.contents),
      }
    },
    toModelOutput: (output) => ({
      type: "json" as const,
      value: (output.data ?? output.metadata ?? { text: output.text }) as JSONValue,
    }),
  }),
  {
    title: "Read MCP Resource",
    capabilities: mcpResourceCapabilities,
  },
)
