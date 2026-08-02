import { describe, expect, it } from "bun:test"
import { ToolModuleIDSchema } from "@anybox/shared"
import z from "zod"
import * as Agent from "#agent/agent.ts"
import { Instance } from "#project/instance.ts"
import * as Tool from "#tool/tool.ts"
import * as ToolModule from "#tool/module.ts"
import * as ToolRegistry from "#tool/registry.ts"
import "./sqlite.cleanup.ts"

function probeTool(id: string, source?: Tool.ToolSource) {
  return Tool.define(
    id,
    async () => ({
      title: id,
      description: `${id} test tool.`,
      parameters: z.object({}),
      execute: async () => ({ text: "ok" }),
    }),
    {
      title: id,
      description: `${id} test tool.`,
      capabilities: {
        kind: "read",
        readOnly: true,
      },
      source,
    },
  )
}

describe("universal tool module catalog", () => {
  it("builds the registered built-in catalog without project context", async () => {
    const tools = await ToolRegistry.builtinTools()
    const catalog = ToolModule.catalogRegisteredTools({ tools })
    const execution = catalog.entries.find((entry) => entry.descriptor.id === "workspace.execution")

    expect(catalog.failures).toEqual([])
    expect(execution).toMatchObject({
      active: true,
      exposure: "direct",
      descriptor: {
        provider: {
          kind: "builtin",
          id: "anybox",
        },
        activation: {
          mode: "always",
          scope: "global",
          discovery: "none",
        },
      },
    })
  })

  it("assigns every builtin tool to a stable capability module", async () => {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const tools = await ToolRegistry.builtinTools()

        expect(tools.length).toBeGreaterThan(0)
        for (const item of tools) {
          expect(item.source?.moduleID).toBeTruthy()
          expect(item.source?.provider).toMatchObject({
            kind: "builtin",
            id: "anybox",
          })
          expect(ToolModuleIDSchema.safeParse(item.source?.moduleID).success).toBe(true)
        }

        expect(tools.find((item) => item.id === "tool_search")?.source?.moduleID).toBe("runtime.bootstrap")
        expect(tools.find((item) => item.id === "read_file")?.source?.moduleID).toBe("workspace.files")
        expect(tools.find((item) => item.id === "apply_patch")?.source?.moduleID).toBe("workspace.edit")
        expect(tools.find((item) => item.id === "exec")?.source?.moduleID).toBe("workspace.execution")

        const catalog = await ToolModule.catalog({ tools })
        const builtinEntries = catalog.entries.filter((entry) => entry.descriptor.provider.kind === "builtin")
        expect(builtinEntries.length).toBeGreaterThan(1)
        expect(builtinEntries.every((entry) => entry.active && entry.exposure === "direct")).toBe(true)
      },
    })
  })

  it("does not register removed background task tools or aliases", async () => {
    const tools = await ToolRegistry.builtinTools()
    const exposedNames = tools.flatMap((tool) => [tool.id, ...(tool.aliases ?? [])])
    const removedNames = [
      "read_background_task",
      "read-background-task",
      "stop_background_task",
      "stop-background-task",
    ]

    for (const name of removedNames) expect(exposedNames).not.toContain(name)
    expect(JSON.stringify(ToolModule.catalogRegisteredTools({ tools }))).not.toContain("background_task")
    expect(Agent.planAgent.tools?.write_stdin).toBe(true)
    expect(Agent.planAgent.tools).not.toHaveProperty("read_background_task")
    expect(Agent.planAgent.tools).not.toHaveProperty("stop_background_task")
  })

  it("groups legacy MCP tools by server while preserving configured and turn activation", async () => {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const raw = probeTool("mcp__gmail__search_messages", {
          kind: "mcp",
          id: "gmail",
          name: "Gmail",
          description: "Search email.",
        })
        const item = ToolModule.attachRegisteredToolSource(raw, "mcp")
        const moduleID = ToolModule.mcpModuleID("gmail")

        expect(item.source).toMatchObject({
          kind: "mcp",
          id: "gmail",
          moduleID,
          provider: {
            kind: "mcp",
            id: "gmail",
          },
        })

        const deferred = await ToolModule.catalog({ tools: [item] })
        expect(deferred.entries.find((entry) => entry.descriptor.id === moduleID)).toMatchObject({
          active: false,
          exposure: "deferred",
          descriptor: {
            activation: {
              discovery: "tool",
            },
          },
        })

        const configured = await ToolModule.catalog({
          tools: [item],
          persistentMcpServerIDs: ["gmail"],
        })
        expect(configured.entries.find((entry) => entry.descriptor.id === moduleID)).toMatchObject({
          active: true,
          exposure: "direct",
          turnActivated: false,
        })

        const explicit = await ToolModule.catalog({
          tools: [item],
          activatedModuleIDs: [moduleID],
        })
        expect(explicit.entries.find((entry) => entry.descriptor.id === moduleID)).toMatchObject({
          active: true,
          exposure: "direct",
          turnActivated: true,
        })
      },
    })
  })

  it("keeps lazy modules unloaded until activation and attaches provider provenance", async () => {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const moduleState = await ToolModule.state()
        let loadCount = 0
        const descriptor: ToolModule.NativeToolModuleDescriptor = {
          id: "test.lazy-capability",
          title: "Lazy Capability",
          description: "A lazily loaded capability used by module catalog tests.",
          keywords: ["lazy", "capability"],
          toolIDs: ["lazy_probe"],
          provider: {
            kind: "native",
            id: "test-provider",
            name: "Test Provider",
          },
          activation: {
            mode: "search-or-explicit",
            scope: "turn",
            discovery: "module",
          },
          load: async () => {
            loadCount += 1
            return [probeTool("lazy_probe")]
          },
        }
        moduleState.custom.push(descriptor)

        try {
          const inactive = await ToolModule.catalog({ tools: [] })
          expect(loadCount).toBe(0)
          expect(inactive.entries.find((entry) => entry.descriptor.id === descriptor.id)).toMatchObject({
            active: false,
            exposure: "hidden",
            tools: [],
          })

          const active = await ToolModule.catalog({
            tools: [],
            activatedModuleIDs: [descriptor.id],
          })
          expect(loadCount).toBe(1)
          expect(active.failures).toEqual([])
          expect(active.entries.find((entry) => entry.descriptor.id === descriptor.id)).toMatchObject({
            active: true,
            exposure: "direct",
            turnActivated: true,
            tools: [{
              source: {
                kind: "native-module",
                moduleID: descriptor.id,
                provider: {
                  kind: "native",
                  id: "test-provider",
                },
              },
            }],
          })
        } finally {
          const index = moduleState.custom.indexOf(descriptor)
          if (index >= 0) moduleState.custom.splice(index, 1)
        }
      },
    })
  })

  it("creates deterministic valid module ids for arbitrary MCP server ids", () => {
    const first = ToolModule.mcpModuleID("Google Calendar / Work")
    const second = ToolModule.mcpModuleID("Google Calendar / Work")
    const long = ToolModule.mcpModuleID("a".repeat(256))

    expect(first).toBe(second)
    expect(first.startsWith("mcp.google-calendar-work-")).toBe(true)
    expect(ToolModuleIDSchema.parse(first)).toBe(first)
    expect(ToolModuleIDSchema.parse(long)).toBe(long)
  })
})
