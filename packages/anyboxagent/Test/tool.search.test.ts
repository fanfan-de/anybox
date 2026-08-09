import { describe, expect, it, setDefaultTimeout } from "bun:test"
import z from "zod"
import * as Agent from "#agent/agent.ts"
import * as Config from "#config/config.ts"
import * as Identifier from "#id/id.ts"
import { Instance } from "#project/instance.ts"
import {
  readTurnDiscoveredToolNames,
  readTurnDiscoveredToolModuleIDs,
  resolveToolPlan,
} from "#session/core/resolve-tools.ts"
import {
  createToolSearchIndex,
  type ToolSearchDefinition,
} from "#session/core/tool-search.ts"
import type * as Message from "#session/core/message.ts"
import * as Tool from "#tool/tool.ts"
import * as ToolModule from "#tool/module.ts"
import * as ToolRegistry from "#tool/registry.ts"
import {
  TOOL_SEARCH_ID,
  TOOL_SEARCH_MODEL_NAME,
} from "#tool/tool-search.ts"

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

async function withNativeModule<T>(
  run: (input: {
    base: {
      agent: Agent.AgentInfo
      sessionID: string
      messageID: string
      abort: AbortSignal
      toolSearchEnabled: boolean
    }
    getLoadCount: () => number
    moduleID: string
    modelToolName: string
  }) => Promise<T>,
) {
  return Instance.provide({
    directory: process.cwd(),
    async fn() {
      const agent = await Agent.get("default")
      if (!agent) throw new Error("Expected default agent")
      const moduleState = await ToolModule.state()
      const moduleID = "test.lantern-planner"
      const toolID = "planner_lantern_probe"
      let loadCount = 0
      const descriptor: ToolModule.NativeToolModuleDescriptor = {
        id: moduleID,
        title: "Lantern Planner",
        description: "A unique lantern scheduling capability used by tests.",
        keywords: ["lantern", "schedule", "灯笼"],
        toolIDs: [toolID],
        load: async () => {
          loadCount += 1
          return [Tool.define(
            toolID,
            async () => ({
              title: "Lantern Probe",
              description: "Read the lantern schedule.",
              parameters: z.object({}),
              execute: async () => ({ text: "lantern-ready" }),
            }),
            {
              title: "Lantern Probe",
              description: "Read the lantern schedule.",
              capabilities: {
                kind: "read",
                readOnly: true,
                destructive: false,
                concurrency: "safe",
              },
            },
          )]
        },
      }
      moduleState.custom.push(descriptor)

      try {
        return await run({
          base: {
            agent,
            sessionID: Identifier.ascending("session"),
            messageID: Identifier.ascending("message"),
            abort: new AbortController().signal,
            toolSearchEnabled: true,
          },
          getLoadCount: () => loadCount,
          moduleID,
          modelToolName: Tool.toModelToolName(toolID),
        })
      } finally {
        const index = moduleState.custom.indexOf(descriptor)
        if (index >= 0) moduleState.custom.splice(index, 1)
      }
    },
  })
}

describe("native tool module planning", () => {
  it("keeps inactive modules out of the registry and loads a search hit on the next model call", async () => {
    await withNativeModule(async ({ base, getLoadCount, moduleID, modelToolName }) => {
      const initialPlan = await resolveToolPlan(base)

      expect(getLoadCount()).toBe(0)
      expect(initialPlan.registryTools[modelToolName]).toBeUndefined()
      expect(initialPlan.visibleTools[modelToolName]).toBeUndefined()
      expect(initialPlan.toolSources[modelToolName]).toBeUndefined()
      expect(initialPlan.activeToolModuleIDs).toEqual([])
      expect(initialPlan.registryTools[TOOL_SEARCH_MODEL_NAME]?.description).not.toContain(moduleID)
      expect(initialPlan.registryTools[TOOL_SEARCH_MODEL_NAME]?.description).not.toContain("Lantern Planner")

      const searchOutput = await initialPlan.registryTools[TOOL_SEARCH_MODEL_NAME]?.execute?.(
        { query: "lantern scheduling" },
        {
          toolCallId: "call-module-search",
          messages: [],
          abortSignal: new AbortController().signal,
        } as never,
      ) as Tool.ToolOutput | undefined

      expect(getLoadCount()).toBe(0)
      expect(searchOutput?.metadata).toMatchObject({
        kind: "tool-search",
        loadedToolModuleIDs: [moduleID],
      })

      const discoveredPlan = await resolveToolPlan({
        ...base,
        discoveredToolModuleIDs: [moduleID],
      })

      expect(getLoadCount()).toBe(1)
      expect(discoveredPlan.activeToolModuleIDs).toEqual([moduleID])
      expect(discoveredPlan.visibleTools[modelToolName]).toBeDefined()
      expect(discoveredPlan.toolSources[modelToolName]).toMatchObject({
        kind: "native-module",
        id: moduleID,
      })
      expect(discoveredPlan.entries.find((entry) => entry.modelName === modelToolName)).toMatchObject({
        exposure: "direct",
        discovered: false,
        item: {
          source: {
            kind: "native-module",
            id: moduleID,
          },
        },
      })

      const nextTurnPlan = await resolveToolPlan(base)

      expect(getLoadCount()).toBe(1)
      expect(nextTurnPlan.activeToolModuleIDs).toEqual([])
      expect(nextTurnPlan.registryTools[modelToolName]).toBeUndefined()
      expect(nextTurnPlan.visibleTools[modelToolName]).toBeUndefined()
      expect(nextTurnPlan.toolSources[modelToolName]).toBeUndefined()
    })
  })

  it("loads an explicitly requested module for the first model call", async () => {
    await withNativeModule(async ({ base, getLoadCount, moduleID, modelToolName }) => {
      const plan = await resolveToolPlan({
        ...base,
        turnToolModuleIDs: [moduleID, moduleID],
      })

      expect(getLoadCount()).toBe(1)
      expect(plan.activeToolModuleIDs).toEqual([moduleID])
      expect(plan.visibleTools[modelToolName]).toBeDefined()
      expect(plan.toolSources[modelToolName]).toMatchObject({
        kind: "native-module",
        id: moduleID,
      })
      expect(plan.registryTools[TOOL_SEARCH_MODEL_NAME]?.description ?? "").not.toContain(moduleID)
    })
  })

  it("keeps inactive modules hidden when tool search is disabled", async () => {
    await withNativeModule(async ({ base, getLoadCount, modelToolName }) => {
      const plan = await resolveToolPlan({
        ...base,
        toolSearchEnabled: false,
      })

      expect(getLoadCount()).toBe(0)
      expect(plan.registryTools[modelToolName]).toBeUndefined()
      expect(plan.visibleTools[modelToolName]).toBeUndefined()
      expect(plan.registryTools[TOOL_SEARCH_MODEL_NAME]).toBeUndefined()
    })
  })
})

describe("deferred tool planning", () => {
  it("keeps deferred tools uninitialized and exposes a non-reserved search alias", async () => {
    await withDeferredTool(async ({ base }) => {
      const plan = await resolveToolPlan(base)

      expect(TOOL_SEARCH_MODEL_NAME).not.toBe(TOOL_SEARCH_ID)
      expect(plan.registryTools[GMAIL_MODEL_TOOL_NAME]).toBeUndefined()
      expect(plan.visibleTools[GMAIL_MODEL_TOOL_NAME]).toBeUndefined()
      expect(plan.activeToolNames).not.toContain(GMAIL_MODEL_TOOL_NAME)
      expect(plan.activeToolNames).toContain(TOOL_SEARCH_MODEL_NAME)
      expect(plan.activeToolNames).not.toContain(TOOL_SEARCH_ID)
      expect(plan.registryTools[TOOL_SEARCH_MODEL_NAME]?.description).not.toContain("gmail: Gmail")
      expect(plan.registryTools[TOOL_SEARCH_MODEL_NAME]?.description).not.toContain("search_messages")
      expect(plan.entries.find((entry) => entry.item.id === TOOL_SEARCH_ID)).toMatchObject({
        modelName: TOOL_SEARCH_MODEL_NAME,
        exposure: "direct",
      })
      expect(plan.entries.find((entry) => entry.modelName === GMAIL_MODEL_TOOL_NAME)).toMatchObject({
        exposure: "deferred",
        discovered: false,
      })

      const searchTool = plan.registryTools[TOOL_SEARCH_MODEL_NAME]
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

      expect(plan.registryTools[GMAIL_MODEL_TOOL_NAME]).toBeUndefined()
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
      expect(plan.registryTools[TOOL_SEARCH_MODEL_NAME]?.description ?? "").not.toContain(
        "gmail: Gmail",
      )
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
      expect(plan.registryTools[TOOL_SEARCH_MODEL_NAME]?.description ?? "").not.toContain(
        "gmail: Gmail",
      )
    })
  })

  it("falls back to all-direct visibility when tool search is disabled", async () => {
    await withDeferredTool(async ({ base }) => {
      const plan = await resolveToolPlan({
        ...base,
        toolSearchEnabled: false,
      })

      expect(plan.activeToolNames).toContain(GMAIL_MODEL_TOOL_NAME)
      expect(plan.registryTools[TOOL_SEARCH_MODEL_NAME]).toBeUndefined()
    })
  })

  it("falls back to all-direct visibility when the global tool switch is disabled", async () => {
    await withDeferredTool(async ({ base }) => {
      const previousSelection = await Config.getToolSelection(Config.GLOBAL_CONFIG_ID)
      await Config.setToolSelection(Config.GLOBAL_CONFIG_ID, {
        ...previousSelection.tools,
        [TOOL_SEARCH_ID]: false,
      })

      try {
        const plan = await resolveToolPlan(base)

        expect(plan.activeToolNames).toContain(GMAIL_MODEL_TOOL_NAME)
        expect(plan.registryTools[TOOL_SEARCH_MODEL_NAME]).toBeUndefined()
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
            [TOOL_SEARCH_ID]: false,
          },
        },
      })

      expect(plan.activeToolNames).toContain(GMAIL_MODEL_TOOL_NAME)
      expect(plan.registryTools[TOOL_SEARCH_MODEL_NAME]).toBeUndefined()
      expect(plan.entries.find((entry) => entry.modelName === GMAIL_MODEL_TOOL_NAME)).toMatchObject({
        exposure: "direct",
        discovered: false,
      })
    })
  })

  it("restores discoveries from the current alias and legacy tool_search history", () => {
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
          id: "tool-part-v3-53",
          type: "tool",
          tool: TOOL_SEARCH_MODEL_NAME,
          sessionID: "session-test",
          messageID: "message-test",
          callID: "tool-call-v3-53",
          schemaVersion: 3,
          turnID: "turn-test",
          input: { raw: JSON.stringify({}), value: {} },
          source: { kind: "model" },
          retry: { attempt: 1 },
          revision: 1,
          timestamps: { createdAt: 1, settledAt: 1 },
          state: { phase: "settled", outcome: { kind: "returned", result: "success", completeness: "complete", output: "", metadata: {
              kind: "tool-search",
              loadedToolNames: [GMAIL_MODEL_TOOL_NAME],
              loadedToolModuleIDs: ["planner.core"],
            }, execution: { sideEffect: "unknown", retry: "unknown" } }, control: { mode: "continue-model" } },
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
    expect([...readTurnDiscoveredToolModuleIDs(messages, "user-1")]).toEqual([
      "planner.core",
    ])
    expect([...readTurnDiscoveredToolModuleIDs(messages, "user-2")]).toEqual([])

    const messagesWithLaterSearch = [
      ...messages,
      {
        info: {
          id: "assistant-2",
          role: "assistant",
        },
        parts: [{
          id: "tool-part-v3-60",
          type: "tool",
          tool: TOOL_SEARCH_ID,
          sessionID: "session-test",
          messageID: "message-test",
          callID: "tool-call-v3-60",
          schemaVersion: 3,
          turnID: "turn-test",
          input: { raw: JSON.stringify({}), value: {} },
          source: { kind: "model" },
          retry: { attempt: 1 },
          revision: 1,
          timestamps: { createdAt: 1, settledAt: 1 },
          state: { phase: "settled", outcome: { kind: "returned", result: "success", completeness: "complete", output: "", metadata: {
              kind: "tool-search",
              loadedToolNames: ["mcp_feishu_search_docs"],
            }, execution: { sideEffect: "unknown", retry: "unknown" } }, control: { mode: "continue-model" } },
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
