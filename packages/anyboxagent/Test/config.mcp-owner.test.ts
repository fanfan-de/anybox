import { afterEach, describe, expect, test } from "bun:test"
import "./sqlite.cleanup.ts"
import { randomUUID } from "node:crypto"
import * as Config from "#config/config.ts"
import * as db from "#database/Sqlite.ts"

const configIDs = new Set<string>()

function configID(label: string) {
  const id = `mcp-owner-${label}-${randomUUID()}`
  configIDs.add(id)
  return id
}

afterEach(() => {
  for (const id of configIDs) {
    db.deleteMany("project_configs", [{ column: "projectID", value: id }])
  }
  configIDs.clear()
})

describe("MCP server ownership config", () => {
  test("keeps owner out of public MCP server input", () => {
    const result = Config.McpServerInput.safeParse({
      command: "node",
      owner: {
        kind: "plugin",
        pluginID: "docs",
        bindingID: "mcp:default",
      },
    })

    expect(result.success).toBe(false)
  })

  test("assigns user ownership to new public servers and ignores spoofed owners", async () => {
    const id = configID("public")
    const server = await Config.setMcpServer(id, "custom", {
      command: "node",
      owner: {
        kind: "plugin",
        pluginID: "spoofed",
        bindingID: "mcp:default",
      },
    } as unknown as Config.McpServerInput)

    expect(server.owner).toEqual({
      kind: "user",
    })
    expect((await Config.getMcpServer(id, "custom"))?.owner).toEqual({
      kind: "user",
    })
  })

  test("round-trips managed owner and connector runtime metadata", async () => {
    const id = configID("managed")
    const connectorOwner = {
      kind: "connector",
      connectorId: "connector:gmail:default",
      runtimeID: "search",
    } as const

    await Config.setManagedMcpServer(
      id,
      "connector.gmail.search",
      {
        name: "Gmail Search",
        transport: "connector",
        connectorId: "connector:gmail:default",
        connectorRuntimeId: "search",
        enabled: true,
      },
      connectorOwner,
    )

    const connector = await Config.getMcpServer(id, "connector.gmail.search")
    expect(connector).toMatchObject({
      transport: "connector",
      connectorId: "connector:gmail:default",
      connectorRuntimeId: "search",
      owner: connectorOwner,
    })

    const pluginOwner = {
      kind: "plugin",
      pluginID: "docs",
      bindingID: "mcp:remote",
    } as const
    await Config.setManagedMcpServer(
      id,
      "plugin.docs.remote",
      {
        transport: "remote",
        connectorId: "plugin-connector:docs:default",
        connectorRuntimeId: "remote",
      },
      pluginOwner,
    )

    expect(await Config.getMcpServer(id, "plugin.docs.remote")).toMatchObject({
      transport: "remote",
      connectorId: "plugin-connector:docs:default",
      connectorRuntimeId: "remote",
      owner: pluginOwner,
    })
  })

  test("preserves managed ownership during public updates", async () => {
    const id = configID("preserve")
    const owner = {
      kind: "anybox",
      bindingID: "browser:default",
    } as const

    await Config.setManagedMcpServer(
      id,
      "connector.browser.default",
      {
        transport: "connector",
        connectorId: "connector:browser:default",
        connectorRuntimeId: "default",
        enabled: true,
      },
      owner,
    )

    const updated = await Config.setMcpServer(id, "connector.browser.default", {
      transport: "connector",
      connectorId: "connector:browser:default",
      connectorRuntimeId: "default",
      enabled: false,
      owner: {
        kind: "user",
      },
    } as unknown as Config.McpServerInput)

    expect(updated.enabled).toBe(false)
    expect(updated.owner).toEqual(owner)
  })

  test("reads and updates legacy servers without adding ownership", async () => {
    const id = configID("legacy")
    await Config.set(id, {
      mcp: {
        servers: {
          legacy: {
            id: "legacy",
            command: "node",
          },
        },
      },
    })

    expect(await Config.getMcpServer(id, "legacy")).toMatchObject({
      id: "legacy",
      transport: "stdio",
      enabled: true,
    })
    expect((await Config.getMcpServer(id, "legacy"))?.owner).toBeUndefined()

    const updated = await Config.setMcpServer(id, "legacy", {
      command: "bun",
    })
    expect(updated.owner).toBeUndefined()
    expect(updated.transport === "stdio" ? updated.command : undefined).toBe("bun")
  })

  test("removes a selected MCP server id from every project transactionally", async () => {
    const first = configID("selection-first")
    const second = configID("selection-second")
    const untouched = configID("selection-untouched")

    await Config.setSelectedMcpServerIDs(first, ["target", "keep"])
    await Config.setSelectedMcpServerIDs(second, ["target"])
    await Config.setSelectedMcpServerIDs(untouched, ["keep"])

    const result = await Config.removeSelectedMcpServerIDFromAllProjects(" target ")

    expect(result.affectedProjectIDs.toSorted()).toEqual([first, second].toSorted())
    expect(result.affectedCount).toBe(2)
    expect(await Config.getSelectedMcpServerIDs(first)).toEqual(["keep"])
    expect(await Config.getSelectedMcpServerIDs(second)).toEqual([])
    expect(await Config.getSelectedMcpServerIDs(untouched)).toEqual(["keep"])
  })
})
