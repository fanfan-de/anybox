import z from "zod"
import * as Tool from "#tool/tool.ts"

export const TOOL_SEARCH_ID = "tool_search"
// `tool_search` is reserved by OpenAI's Responses API for its provider-owned
// tool search protocol. Keep the stable catalog/config ID above, but expose a
// distinct model-facing name so ordinary Anybox function calls are replayed as
// `function_call` items instead of `tool_search_call` items.
export const TOOL_SEARCH_MODEL_NAME = "anybox_tool_search"

export const ToolSearchParameters = z.object({
  query: z.string().min(1).describe("Capability or action needed for the current user request."),
  limit: z.number().int().min(1).max(32).optional().describe("Maximum matches to return. Defaults to 8."),
})

export const ToolSearchTool = Tool.define(
  TOOL_SEARCH_ID,
  async () => ({
    title: "Tool Search",
    description:
      "Search and load optional Anybox capability modules or deferred tools needed for the current request. Loaded tools are available on the next model call in this user turn only.",
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
