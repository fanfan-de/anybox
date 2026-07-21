import { describe, expect, test } from "bun:test"
import "./sqlite.cleanup.ts"
import * as Config from "../src/config/config.ts"
import * as BuiltinMcp from "../src/mcp/builtin.ts"

const retiredServerID = "anybox.computer-use"

describe("retired Computer Use built-in binding", () => {
  test("is no longer a built-in MCP definition", () => {
    expect(BuiltinMcp.listDefinitions().map((definition) => definition.id)).toEqual([
      BuiltinMcp.NODE_REPL_DEFINITION_ID,
    ])
    expect(BuiltinMcp.getDefinition("computer-use")).toBeUndefined()
    expect(BuiltinMcp.serverIDForDefinition("computer-use")).toBeUndefined()
  })

  test("removes a canonical stale binding and project selections during sync", async () => {
    await Config.setManagedMcpServer(
      Config.GLOBAL_CONFIG_ID,
      retiredServerID,
      {
        name: "Retired Computer Use",
        transport: "stdio",
        command: "__anybox_in_process__",
        args: [],
        enabled: true,
      },
      {
        kind: "anybox",
        bindingID: "computer-use",
      },
    )
    await Config.setSelectedMcpServerIDs("project-retired-computer-use", [retiredServerID])

    await BuiltinMcp.syncBuiltinMcpRuntimeBindings()

    expect(await Config.getMcpServer(Config.GLOBAL_CONFIG_ID, retiredServerID)).toBeUndefined()
    expect(await Config.getSelectedMcpServerIDs("project-retired-computer-use")).toEqual([])
  })

  test("does not delete an unrelated user-owned server with the retired id", async () => {
    await Config.setMcpServer(Config.GLOBAL_CONFIG_ID, retiredServerID, {
      name: "User-owned server",
      transport: "stdio",
      command: "node",
      args: ["fixture.js"],
      enabled: true,
    })

    await BuiltinMcp.syncBuiltinMcpRuntimeBindings()

    expect(await Config.getMcpServer(Config.GLOBAL_CONFIG_ID, retiredServerID)).toMatchObject({
      owner: { kind: "user" },
      command: "node",
    })
  })
})
