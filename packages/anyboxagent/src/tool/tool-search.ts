import z from "zod"
import * as Tool from "#tool/tool.ts"

export const TOOL_SEARCH_ID = "tool_search"

export const ToolSearchParameters = z.object({
  query: z.string().min(1).describe("Capability, MCP source, tool name, or schema field to search for."),
  limit: z.number().int().min(1).max(32).optional().describe("Maximum matches to return. Defaults to 8."),
})

export const ToolSearchTool = Tool.define(
  TOOL_SEARCH_ID,
  async () => ({
    title: "Tool Search",
    description:
      "Search currently registered deferred MCP tools. The runtime activates this tool only for turns that have eligible deferred candidates.",
    parameters: ToolSearchParameters,
    execute: async () => {
      throw new Error(
        "The tool_search catalog definition cannot execute directly. It must be bound to the current Turn tool plan.",
      )
    },
  }),
  {
    title: "Tool Search",
    capabilities: {
      kind: "search",
      readOnly: true,
      destructive: false,
    },
  },
)
