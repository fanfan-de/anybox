import { describe, expect, it, setDefaultTimeout } from "bun:test"
import z from "zod"
import * as Agent from "#agent/agent.ts"
import * as Config from "#config/config.ts"
import * as Identifier from "#id/id.ts"
import { Instance } from "#project/instance.ts"
import {
  readTurnDiscoveredToolNames,
  resolveToolPlan,
} from "#session/core/resolve-tools.ts"
import {
  createToolSearchIndex,
  type ToolSearchDefinition,
} from "#session/core/tool-search.ts"
import type * as Message from "#session/core/message.ts"
import * as Tool from "#tool/tool.ts"
import * as ToolRegistry from "#tool/registry.ts"

const GMAIL_MODEL_TOOL_NAME = "mcp_gmail_search_messages"
setDefaultTimeout(20_000)

function gmailTool() {
  return Tool.define(
    "mcp__gmail__search_messages",
    async () => ({
      title: "Search Gmail",
      description: "Search email messages by sender, subject, or content.",
      parameters: z.object({
        query: z.string().describe("Email search query"),
      }),
      execute: async ({ query }) => ({
        text: `searched:${query}`,
      }),
    }),
    {
      capabilities: {
        kind: "search",
        readOnly: true,
      },
      source: {
        kind: "mcp",
        id: "gmail",
        name: "Gmail",
        description: "Search and read email.",
      },
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            minLength: 3,
            description: "Email search query",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  )
}

async function withDeferredTool<T>(
  run: (input: {
    agent: Agent.AgentInfo
    base: {
      agent: Agent.AgentInfo
      sessionID: string
      messageID: string
      abort: AbortSignal
      toolSearchEnabled: boolean
    }
  }) => Promise<T>,
) {
  return Instance.provide({
    directory: process.cwd(),
    async fn() {
      const agent = await Agent.get("default")
      if (!agent) throw new Error("Expected default agent")
      const registry = await ToolRegistry.state()
      const definition = gmailTool()
      registry.custom.push(definition)

      try {
        return await run({
          agent,
          base: {
            agent,
            sessionID: Identifier.ascending("session"),
            messageID: Identifier.ascending("message"),
            abort: new AbortController().signal,
            toolSearchEnabled: true,
          },
        })
      } finally {
        const index = registry.custom.indexOf(definition)
        if (index >= 0) registry.custom.splice(index, 1)
      }
    },
  })
}

describe("deferred tool planning", () => {
  it("keeps deferred tools registered but initially exposes only tool_search", async () => {
    await withDeferredTool(async ({ base }) => {
      const plan = await resolveToolPlan(base)

      expect(plan.registryTools[GMAIL_MODEL_TOOL_NAME]).toBeDefined()
      expect(plan.visibleTools[GMAIL_MODEL_TOOL_NAME]).toBeUndefined()
      expect(plan.activeToolNames).not.toContain(GMAIL_MODEL_TOOL_NAME)
      expect(plan.activeToolNames).toContain("tool_search")
      expect(plan.registryTools.tool_search?.description).toContain("gmail: Gmail")
      expect(plan.registryTools.tool_search?.description).not.toContain("search_messages")
      expect(plan.entries.find((entry) => entry.modelName === GMAIL_MODEL_TOOL_NAME)).toMatchObject({
        exposure: "deferred",
        discovered: false,
      })

      const searchTool = plan.registryTools.tool_search
      const output = await searchTool?.execute?.(
        { query: "email sender" },
        {
          toolCallId: "call-search",
          messages: [],
          abortSignal: new AbortController().signal,
        } as never,
      ) as Tool.ToolOutput | undefined

      expect(output?.metadata).toMatchObject({
        kind: "tool-search",
        loadedToolNames: [GMAIL_MODEL_TOOL_NAME],
      })
      expect(output?.text).toContain('"inputSchema"')
      expect(output?.text).toContain('"query"')
      expect(output?.text).toContain('"minLength":3')

      const deferredOutput = await plan.registryTools[GMAIL_MODEL_TOOL_NAME]?.execute?.(
        { query: "inbox" },
        {
          toolCallId: "call-deferred-directly",
          messages: [],
          abortSignal: new AbortController().signal,
        } as never,
      ) as Tool.ToolOutput | undefined
      expect(deferredOutput?.text).toBe("searched:inbox")
    })
  })

  it("makes a search hit visible on the next model call without changing its exposure", async () => {
    await withDeferredTool(async ({ base }) => {
      const plan = await resolveToolPlan({
        ...base,
        discoveredToolNames: [GMAIL_MODEL_TOOL_NAME],
      })

      expect(plan.activeToolNames).toContain(GMAIL_MODEL_TOOL_NAME)
      expect(plan.visibleTools[GMAIL_MODEL_TOOL_NAME]).toBeDefined()
      expect(plan.entries.find((entry) => entry.modelName === GMAIL_MODEL_TOOL_NAME)).toMatchObject({
        exposure: "deferred",
        discovered: true,
      })
      expect(plan.registryTools.tool_search).toBeUndefined()
    })
  })

  it("treats turn-scoped MCP sources as direct and never indexes them", async () => {
    await withDeferredTool(async ({ base }) => {
      const plan = await resolveToolPlan({
        ...base,
        turnMcpServerIDs: ["gmail"],
      })

      expect(plan.activeToolNames).toContain(GMAIL_MODEL_TOOL_NAME)
      expect(plan.entries.find((entry) => entry.modelName === GMAIL_MODEL_TOOL_NAME)).toMatchObject({
        exposure: "direct",
        discovered: false,
      })
      expect(plan.registryTools.tool_search).toBeUndefined()
    })
  })

  it("falls back to all-direct visibility when tool search is disabled", async () => {
    await withDeferredTool(async ({ base }) => {
      const plan = await resolveToolPlan({
        ...base,
        toolSearchEnabled: false,
      })

      expect(plan.activeToolNames).toContain(GMAIL_MODEL_TOOL_NAME)
      expect(plan.registryTools.tool_search).toBeUndefined()
    })
  })

  it("falls back to all-direct visibility when the global tool switch is disabled", async () => {
    await withDeferredTool(async ({ base }) => {
      const previousSelection = await Config.getToolSelection(Config.GLOBAL_CONFIG_ID)
      await Config.setToolSelection(Config.GLOBAL_CONFIG_ID, {
        ...previousSelection.tools,
        tool_search: false,
      })

      try {
        const plan = await resolveToolPlan(base)

        expect(plan.activeToolNames).toContain(GMAIL_MODEL_TOOL_NAME)
        expect(plan.registryTools.tool_search).toBeUndefined()
        expect(plan.entries.find((entry) => entry.modelName === GMAIL_MODEL_TOOL_NAME)).toMatchObject({
          exposure: "direct",
          discovered: false,
        })
      } finally {
        await Config.setToolSelection(Config.GLOBAL_CONFIG_ID, previousSelection.tools)
      }
    })
  })

  it("falls back to all-direct visibility when the current agent denies tool_search", async () => {
    await withDeferredTool(async ({ base }) => {
      const plan = await resolveToolPlan({
        ...base,
        agent: {
          ...base.agent,
          tools: {
            tool_search: false,
          },
        },
      })

      expect(plan.activeToolNames).toContain(GMAIL_MODEL_TOOL_NAME)
      expect(plan.registryTools.tool_search).toBeUndefined()
      expect(plan.entries.find((entry) => entry.modelName === GMAIL_MODEL_TOOL_NAME)).toMatchObject({
        exposure: "direct",
        discovered: false,
      })
    })
  })

  it("restores discoveries only from tool_search results after the current user message", () => {
    const messages = [
      {
        info: {
          id: "user-1",
          role: "user",
        },
        parts: [],
      },
      {
        info: {
          id: "assistant-1",
          role: "assistant",
        },
        parts: [{
          type: "tool",
          tool: "tool_search",
          state: {
            status: "completed",
            metadata: {
              kind: "tool-search",
              loadedToolNames: [GMAIL_MODEL_TOOL_NAME],
            },
          },
        }],
      },
      {
        info: {
          id: "user-2",
          role: "user",
        },
        parts: [],
      },
    ] as unknown as Message.WithParts[]

    expect([...readTurnDiscoveredToolNames(messages, "user-1")]).toEqual([
      GMAIL_MODEL_TOOL_NAME,
    ])
    expect([...readTurnDiscoveredToolNames(messages, "user-2")]).toEqual([])

    const messagesWithLaterSearch = [
      ...messages,
      {
        info: {
          id: "assistant-2",
          role: "assistant",
        },
        parts: [{
          type: "tool",
          tool: "tool_search",
          state: {
            status: "completed",
            metadata: {
              kind: "tool-search",
              loadedToolNames: ["mcp_feishu_search_docs"],
            },
          },
        }],
      },
    ] as unknown as Message.WithParts[]

    expect([...readTurnDiscoveredToolNames(messagesWithLaterSearch, "user-1")]).toEqual([
      GMAIL_MODEL_TOOL_NAME,
    ])
    expect([...readTurnDiscoveredToolNames(messagesWithLaterSearch, "user-2")]).toEqual([
      "mcp_feishu_search_docs",
    ])
  })
})

describe("tool search BM25 index", () => {
  const definitions: ToolSearchDefinition[] = [
    {
      id: "mcp__gmail__search_messages",
      name: "mcp__gmail__search_messages",
      title: "搜索邮件",
      description: "按发件人和主题搜索邮件",
      inputSchema: {
        type: "object",
        properties: {
          sender: {
            type: "string",
            description: "发件人邮箱",
          },
        },
      },
      source: {
        kind: "mcp",
        id: "gmail",
        name: "Gmail",
        description: "电子邮件服务",
      },
    },
    {
      id: "mcp__feishu__search_docs",
      name: "mcp__feishu__search_docs",
      title: "Search documents",
      description: "Search Feishu documents and knowledge bases",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
          },
        },
      },
      source: {
        kind: "mcp",
        id: "feishu",
        name: "Feishu",
      },
    },
  ]

  it("matches English identifiers, Chinese descriptions, and schema fields deterministically", () => {
    const index = createToolSearchIndex(definitions)

    expect(index.search("gmail")[0]?.name).toBe("mcp__gmail__search_messages")
    expect(index.search("发件人")[0]?.name).toBe("mcp__gmail__search_messages")
    expect(index.search("sender")[0]?.name).toBe("mcp__gmail__search_messages")
    expect(index.search("knowledge base")[0]?.name).toBe("mcp__feishu__search_docs")
  })
})
