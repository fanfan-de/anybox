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
    const shell = catalog.entries.find((entry) => entry.descriptor.id === "workspace.shell")

    expect(catalog.failures).toEqual([])
    expect(shell).toMatchObject({
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

  it("inspects platform native modules without activating or exposing them", async () => {
    const inspected = await ToolModule.inspectNativeModules()
    const planner = inspected.entries.find((entry) => entry.descriptor.id === "planner.core")

    expect(inspected.failures).toEqual([])
    expect(planner).toMatchObject({
      active: false,
      exposure: "hidden",
      turnActivated: false,
      descriptor: {
        provider: {
          kind: "native",
          id: "anybox",
        },
        activation: {
          mode: "search-or-explicit",
          scope: "turn",
          discovery: "module",
        },
      },
    })
    expect(planner?.tools).toHaveLength(12)
    expect(planner?.tools.map((tool) => tool.id)).toEqual(planner?.descriptor.toolIDs)
    expect(planner?.tools.every((tool) => tool.source?.moduleID === "planner.core")).toBe(true)

    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const inactive = await ToolModule.catalog({ tools: [] })
        expect(inactive.entries.find((entry) => entry.descriptor.id === "planner.core")).toMatchObject({
          active: false,
          exposure: "hidden",
          tools: [],
        })

        const activated = await ToolModule.catalog({
          tools: [],
          activatedModuleIDs: ["planner.core"],
        })
        expect(activated.entries.find((entry) => entry.descriptor.id === "planner.core")).toMatchObject({
          active: true,
          exposure: "direct",
          turnActivated: true,
        })
        expect(activated.entries.find((entry) => entry.descriptor.id === "planner.core")?.tools).toHaveLength(12)
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

        expect(tools.find((item) => item.id === "tool_search")?.source?.moduleID).toBe(
          "runtime.progressive-disclosure",
        )
        expect(tools.find((item) => item.id === "load_workspace_dependencies")?.source?.moduleID).toBe(
          "runtime.progressive-disclosure",
        )
        expect(tools.find((item) => item.id === "ask_user_question")?.source?.moduleID).toBe("interaction.human")
        expect(tools.find((item) => item.id === "read_file")?.source?.moduleID).toBe("workspace.file-io")
        expect(tools.find((item) => item.id === "apply_patch")?.source?.moduleID).toBe("workspace.file-io")
        expect(tools.find((item) => item.id === "glob")?.source?.moduleID).toBe("workspace.file-search")
        expect(tools.find((item) => item.id === "exec")?.source?.moduleID).toBe(
          "runtime.programmatic-orchestration",
        )
        expect(tools.find((item) => item.id === "multi_tool_use_parallel")?.source?.moduleID).toBe(
          "runtime.programmatic-orchestration",
        )
        expect(tools.find((item) => item.id === "spawn_subagent")?.source?.moduleID).toBe("agent.multiagent")
        expect(tools.find((item) => item.id === "lsp_definition")?.source?.moduleID).toBe("workspace.lsp")
        expect(tools.find((item) => item.id === "list_rollback_checkpoints")?.source?.moduleID).toBe(
          "agent.metacognition",
        )
        expect(tools.find((item) => item.id === "rollback_to_checkpoint")?.source?.moduleID).toBe(
          "agent.metacognition",
        )
        expect(tools.find((item) => item.id === "web_fetch")?.source?.moduleID).toBe("network.web")
        expect(tools.find((item) => item.id === "generate_image")?.source?.moduleID).toBe(
          "media.visual-generation",
        )

        const catalog = await ToolModule.catalog({ tools })
        const builtinEntries = catalog.entries.filter((entry) => entry.descriptor.provider.kind === "builtin")
        const toolIDsFor = (moduleID: string) =>
          builtinEntries.find((entry) => entry.descriptor.id === moduleID)?.tools.map((item) => item.id) ?? []

        expect(toolIDsFor("workflow.tasks")).toEqual([
          "task_create",
          "task_get",
          "task_list",
          "task_update",
        ])
        expect(toolIDsFor("workspace.file-io")).toEqual([
          "read_file",
          "replace_text",
          "apply_patch",
          "view_image",
        ])
        expect(toolIDsFor("workspace.file-search")).toEqual(["glob", "grep", "list_directory"])
        expect(toolIDsFor("runtime.programmatic-orchestration")).toEqual([
          "multi_tool_use_parallel",
          "exec",
        ])
        expect(toolIDsFor("agent.multiagent")).toEqual([
          "read_subagent",
          "wait_subagent",
          "spawn_subagent",
          "cancel_subagent",
        ])
        expect(toolIDsFor("runtime.progressive-disclosure")).toEqual([
          "load_skill",
          "read_skill_resource",
          "list_mcp_resources",
          "list_mcp_resource_templates",
          "read_mcp_resource",
          "load_workspace_dependencies",
          "tool_search",
        ])
        expect(toolIDsFor("interaction.human")).toEqual(["ask_user_question"])
        expect(toolIDsFor("agent.metacognition")).toEqual([
          "list_rollback_checkpoints",
          "rollback_to_checkpoint",
        ])
        expect(toolIDsFor("network.web")).toEqual(["web_fetch"])
        expect(toolIDsFor("media.visual-generation")).toEqual(["generate_image"])
        expect(toolIDsFor("runtime.other")).toEqual([])
        expect(builtinEntries.length).toBeGreaterThan(1)
        expect(builtinEntries.every((entry) => entry.active && entry.exposure === "direct")).toBe(true)
      },
    })
  })

  it("assigns the IPython builtin to the Python runtime module", () => {
    const item = ToolModule.attachRegisteredToolSource(probeTool("ipython"), "builtin")
    const catalog = ToolModule.catalogRegisteredTools({ tools: [item] })
    const pythonRuntime = catalog.entries.find(
      (entry) => entry.descriptor.id === "runtime.python",
    )

    expect(item.source?.moduleID).toBe("runtime.python")
    expect(pythonRuntime).toMatchObject({
      descriptor: {
        title: "Python Runtime",
        provider: {
          kind: "builtin",
          id: "anybox",
        },
      },
      active: true,
      exposure: "direct",
    })
    expect(pythonRuntime?.tools.map((tool) => tool.id)).toEqual(["ipython"])
  })

  it("does not register removed tools or aliases", async () => {
    const tools = await ToolRegistry.builtinTools()
    const exposedNames = tools.flatMap((tool) => [tool.id, ...(tool.aliases ?? [])])
    const removedNames = [
      "read_background_task",
      "read-background-task",
      "stop_background_task",
      "stop-background-task",
      "enter_plan_mode",
      "enter-plan-mode",
      "EnterPlanMode",
      "exit_plan_mode",
      "exit-plan-mode",
      "ExitPlanMode",
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
