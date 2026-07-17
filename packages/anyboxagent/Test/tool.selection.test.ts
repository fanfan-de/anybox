import { afterEach, describe, expect, it } from "bun:test"
import "./sqlite.cleanup.ts"
import z from "zod"
import * as Agent from "#agent/agent.ts"
import * as Config from "#config/config.ts"
import { Instance } from "#project/instance.ts"
import { resolveTools } from "#session/core/resolve-tools.ts"
import * as ToolRegistry from "#tool/registry.ts"
import * as Tool from "#tool/tool.ts"

async function resolveAgentToolNames(agentName: string) {
  const agent = await Agent.get(agentName)
  if (!agent) {
    throw new Error(`Expected built-in agent '${agentName}' to exist.`)
  }

  return Object.keys(
    await resolveTools({
      agent,
      sessionID: `ses_tool_selection_${agentName}`,
      messageID: `msg_tool_selection_${agentName}`,
      abort: new AbortController().signal,
    }),
  )
}

function activeOneTimeShellToolIDs() {
  return ToolRegistry.builtinShellToolsForPlatform(process.platform).map((tool) => tool.id)
}

describe("global built-in tool selection", () => {
  afterEach(async () => {
    await Config.setToolSelection(Config.GLOBAL_CONFIG_ID, {})
  })

  it("exposes only provider-safe tool names to the model", async () => {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const toolNames = await resolveAgentToolNames("default")
        expect(toolNames.every((name) => /^[a-z0-9_]+$/.test(name))).toBe(true)
        expect(toolNames).toContain("multi_tool_use_parallel")
        expect(toolNames).toContain("exec")
        expect(toolNames).not.toContain("multi_tool_use.parallel")
        expect(toolNames).not.toContain("read-file")
        expect(toolNames).not.toContain("AskUserQuestion")
      },
    })
  })

  it("keeps built-in tools available when the global selection is empty", async () => {
    await Config.setToolSelection(Config.GLOBAL_CONFIG_ID, {})

    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const toolNames = await resolveAgentToolNames("default")
        const shellToolIDs = activeOneTimeShellToolIDs()
        expect(toolNames).toContain("read_file")
        expect(toolNames).toContain("multi_tool_use_parallel")
        expect(toolNames).toContain("exec")
        expect(toolNames).not.toContain("calendar_create_todo")
        expect(toolNames).not.toContain("calendar_create_event")
        expect(toolNames).not.toContain("calendar_list_items")
        for (const shellToolID of shellToolIDs) {
          expect(toolNames).toContain(shellToolID)
        }
        if (process.platform === "darwin") {
          expect(toolNames).not.toContain("git_bash_command")
          expect(toolNames).not.toContain("powershell_command")
          expect(toolNames).not.toContain("cmd_command")
          expect(toolNames).not.toContain("wsl_bash_command")
        }
        expect(toolNames).not.toContain("exec_command")
        expect(toolNames).not.toContain("bash")
        expect(toolNames).not.toContain("exec-command")
        expect(await ToolRegistry.get("exec_command")).toBeUndefined()
        expect(await ToolRegistry.get("bash")).toBeUndefined()
        expect(await ToolRegistry.get("exec-command")).toBeUndefined()
      },
    })
  })

  it("keeps browser tools out of global built-in selection", async () => {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const toolNames = await resolveAgentToolNames("default")
        expect(toolNames.some((name) => name.startsWith("browser_"))).toBe(false)
        expect(await ToolRegistry.get("browser_status")).toBeUndefined()
      },
    })
  })

  it("filters a globally disabled built-in shell tool without legacy aliases", async () => {
    const selectedToolID = activeOneTimeShellToolIDs()[0] ?? "read_file"
    await Config.setToolSelection(Config.GLOBAL_CONFIG_ID, {
      [selectedToolID]: false,
    })

    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const toolNames = await resolveAgentToolNames("default")
        expect(toolNames).not.toContain(selectedToolID)
        for (const shellToolID of activeOneTimeShellToolIDs()) {
          if (shellToolID !== selectedToolID) {
            expect(toolNames).toContain(shellToolID)
          }
        }
        expect(toolNames).not.toContain("exec_command")
        expect(toolNames).not.toContain("bash")
        expect(toolNames).not.toContain("exec-command")
      },
    })
  })

  it("does not let explicit global true bypass the agent allowlist", async () => {
    await Config.setToolSelection(Config.GLOBAL_CONFIG_ID, {
      "replace-text": true,
    })

    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const toolNames = await resolveAgentToolNames("plan")
        expect(toolNames).toContain("read_file")
        expect(toolNames).toContain("multi_tool_use_parallel")
        expect(toolNames).toContain("exec")
        expect(toolNames).not.toContain("replace_text")
      },
    })
  })

  it("filters the built-in parallel tool through global selection", async () => {
    await Config.setToolSelection(Config.GLOBAL_CONFIG_ID, {
      "multi_tool_use.parallel": false,
    })

    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const defaultToolNames = await resolveAgentToolNames("default")
        const planToolNames = await resolveAgentToolNames("plan")
        expect(defaultToolNames).not.toContain("multi_tool_use_parallel")
        expect(planToolNames).not.toContain("multi_tool_use_parallel")
      },
    })
  })

  it("catalogs tool_search as a read-only search tool without activating it unconditionally", async () => {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const builtinTools = await ToolRegistry.builtinTools()
        const catalogTool = builtinTools.find((tool) => tool.id === "tool_search")
        expect(catalogTool).toMatchObject({
          id: "tool_search",
          title: "Tool Search",
          capabilities: {
            kind: "search",
            readOnly: true,
            destructive: false,
          },
        })

        const runtime = await catalogTool?.init()
        expect(runtime?.title).toBe("Tool Search")
        expect(runtime?.parameters.safeParse({ query: "email", limit: 8 }).success).toBe(true)
        expect(runtime?.parameters.safeParse({ query: "", limit: 33 }).success).toBe(false)
        await expect(runtime?.execute(
          { query: "email" },
          {} as Tool.Context,
        )).rejects.toThrow("must be bound to the current Turn tool plan")

        const toolNames = await resolveAgentToolNames("default")
        expect(toolNames).not.toContain("tool_search")
      },
    })
  })

  it("filters exec through global selection", async () => {
    await Config.setToolSelection(Config.GLOBAL_CONFIG_ID, {
      exec: false,
    })

    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const defaultToolNames = await resolveAgentToolNames("default")
        const planToolNames = await resolveAgentToolNames("plan")
        const sideChatToolNames = await resolveAgentToolNames("sidechat")
        expect(defaultToolNames).not.toContain("exec")
        expect(planToolNames).not.toContain("exec")
        expect(sideChatToolNames).not.toContain("exec")
      },
    })
  })

  it("exposes exec to default, plan, and side chat but not compaction", async () => {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        expect(await resolveAgentToolNames("default")).toContain("exec")
        expect(await resolveAgentToolNames("plan")).toContain("exec")
        expect(await resolveAgentToolNames("sidechat")).toContain("exec")
        expect(await resolveAgentToolNames("compaction")).not.toContain("exec")
      },
    })
  })

  it("does not apply built-in selection records to custom tools", async () => {
    await Config.setToolSelection(Config.GLOBAL_CONFIG_ID, {
      "custom-test-tool": false,
    })

    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        const registry = await ToolRegistry.state()
        registry.custom.push(
          Tool.define("custom-test-tool", async () => ({
            description: "Test-only custom tool.",
            parameters: z.object({}),
            execute: async () => "ok",
          })),
        )

        const toolNames = await resolveAgentToolNames("default")
        expect(toolNames).toContain("custom_test_tool")
      },
    })
  })
})
