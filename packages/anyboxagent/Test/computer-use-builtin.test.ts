import { describe, expect, test } from "bun:test"
import "./sqlite.cleanup.ts"
import * as Config from "../src/config/config.ts"
import * as BuiltinMcp from "../src/mcp/builtin.ts"
import { McpManager, diagnoseServer } from "../src/mcp/manager.ts"

function asInput(server: Config.McpStdioServerSummary): Config.McpStdioServerInput {
  return {
    name: server.name,
    enabled: server.enabled,
    timeoutMs: server.timeoutMs,
    transport: "stdio",
    command: server.command,
    args: server.args,
    env: server.env,
    cwd: server.cwd,
    toolPolicies: server.toolPolicies,
  }
}

describe("Anybox Computer Use built-in MCP", () => {
  test("syncs independently of a conflicting Node REPL binding", async () => {
    await Config.setMcpServer(
      Config.GLOBAL_CONFIG_ID,
      BuiltinMcp.NODE_REPL_SERVER_ID,
      {
        name: "User-owned conflict",
        transport: "stdio",
        command: "node",
        args: ["fake.js"],
        enabled: true,
      },
    )
    await BuiltinMcp.syncBuiltinMcpRuntimeBindings()

    expect(
      (await Config.getMcpServer(
        Config.GLOBAL_CONFIG_ID,
        BuiltinMcp.NODE_REPL_SERVER_ID,
      ))?.owner,
    ).toEqual({ kind: "user" })
    const computerUse = await Config.getMcpServer(
      Config.GLOBAL_CONFIG_ID,
      BuiltinMcp.COMPUTER_USE_SERVER_ID,
    )
    expect(computerUse).toMatchObject({
      enabled: true,
      transport: "stdio",
      command: "__anybox_in_process__",
      owner: {
        kind: "anybox",
        bindingID: BuiltinMcp.COMPUTER_USE_DEFINITION_ID,
      },
    })
    expect(BuiltinMcp.isComputerUseServer(computerUse!)).toBe(true)
    expect(BuiltinMcp.isModelToolServer(computerUse!)).toBe(false)
    expect(BuiltinMcp.getPluginCapabilityDefinition("computer-use")).toMatchObject({
      serverID: BuiltinMcp.COMPUTER_USE_SERVER_ID,
      modelExposure: "plugin-capability",
    })
    expect(Object.keys(computerUse?.toolPolicies ?? {})).toHaveLength(14)
    expect((await diagnoseServer(computerUse!))).toMatchObject({
      ok: true,
      toolCount: 14,
    })
  })

  test("keeps low-level Computer Use tools out of the model tool surface", async () => {
    const nodeRepl = await Config.getMcpServer(
      Config.GLOBAL_CONFIG_ID,
      BuiltinMcp.NODE_REPL_SERVER_ID,
    )
    if (nodeRepl) {
      await Config.setMcpServer(
        Config.GLOBAL_CONFIG_ID,
        BuiltinMcp.NODE_REPL_SERVER_ID,
        {
          ...asInput(nodeRepl as Config.McpStdioServerSummary),
          enabled: false,
        },
      )
    }
    await BuiltinMcp.syncBuiltinMcpRuntimeBindings()
    const manager = new McpManager("project-computer-use-hidden-surface")
    try {
      const tools = await manager.tools()
      expect(tools.some((tool) => tool.source?.id === BuiltinMcp.COMPUTER_USE_SERVER_ID)).toBe(false)
      expect(tools.some((tool) => tool.id.includes("computer_use"))).toBe(false)
    } finally {
      await manager.dispose()
    }
  })

  test("preserves user tool controls across built-in resynchronization", async () => {
    await BuiltinMcp.syncBuiltinMcpRuntimeBindings()
    const current = await Config.getMcpServer(
      Config.GLOBAL_CONFIG_ID,
      BuiltinMcp.COMPUTER_USE_SERVER_ID,
    )
    expect(current?.transport).toBe("stdio")
    await Config.setManagedMcpServer(
      Config.GLOBAL_CONFIG_ID,
      BuiltinMcp.COMPUTER_USE_SERVER_ID,
      {
        ...asInput(current as Config.McpStdioServerSummary),
        enabled: false,
        toolPolicies: {
          ...current?.toolPolicies,
          click: { policy: "disabled" },
          type_text: { policy: "disabled" },
        },
      },
      {
        kind: "anybox",
        bindingID: BuiltinMcp.COMPUTER_USE_DEFINITION_ID,
      },
    )

    await BuiltinMcp.syncBuiltinMcpRuntimeBindings()
    expect(await Config.getMcpServer(
      Config.GLOBAL_CONFIG_ID,
      BuiltinMcp.COMPUTER_USE_SERVER_ID,
    )).toMatchObject({
      enabled: false,
      toolPolicies: {
        click: { policy: "disabled" },
        type_text: { policy: "disabled" },
      },
    })
  })

  test("does not trust lookalike third-party server ownership", () => {
    const lookalike = Config.McpServerSummary.parse({
      id: BuiltinMcp.COMPUTER_USE_SERVER_ID,
      name: "Lookalike",
      enabled: true,
      transport: "stdio",
      command: "__anybox_in_process__",
      owner: {
        kind: "plugin",
        pluginID: "lookalike",
        bindingID: "computer-use",
      },
    })
    expect(BuiltinMcp.isComputerUseServer(lookalike)).toBe(false)
  })
})
