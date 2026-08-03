import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ToastProvider } from "./toast"
import type { InstalledPlugin, McpServerSummary, PluginCatalogItem } from "./types"
import { useSettingsPage } from "./use-settings-page"

function createPlugin(id: string, name: string): PluginCatalogItem {
  return {
    id,
    name,
    description: `${name} plugin`,
    version: "1.0.0",
    publisher: "Anybox",
    category: "Code",
    screenshots: [],
    tags: [],
    risk: "low",
    permissions: [],
    tools: [],
    configFields: [
      {
        key: "ROOT_PATH",
        label: "Root path",
        type: "path",
        required: true,
      },
    ],
    mcpServers: [],
    mcpRequirements: [],
    skills: [],
    connectorRequirements: [],
    connectors: [],
    apps: [],
  }
}

function createInstalledPlugin(pluginID: string): InstalledPlugin {
  return {
    pluginID,
    version: "1.0.0",
    enabled: true,
    mcpServerIDs: [],
    mcpServerEnabled: {},
    skillIDs: [],
    connectorIDs: [],
    mcpRequirementIDs: [],
    connectorRequirementIDs: [],
    config: {
      ROOT_PATH: "C:\\Projects",
    },
    installedAt: 1,
    updatedAt: 2,
  }
}

function createPluginMcpServer(pluginID: string, name: string): McpServerSummary {
  return {
    id: `plugin.${pluginID}`,
    name,
    owner: {
      kind: "plugin",
      pluginID,
      bindingID: "mcp:default",
    },
    transport: "stdio",
    command: "node",
    args: ["server.js"],
    enabled: true,
  }
}

function wrapper({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>
}

describe("useSettingsPage plugin state", () => {
  beforeEach(() => {
    window.desktop = undefined
  })

  it("keeps the selected plugin open as installable after uninstalling it", async () => {
    const catalog = [
      createPlugin("filesystem", "Filesystem"),
      createPlugin("docs", "Docs"),
    ]
    let installedPlugins = [createInstalledPlugin("filesystem")]
    const deleteInstalledPlugin = vi.fn().mockImplementation(async () => {
      installedPlugins = []
    })

    window.desktop = {
      getPluginCatalog: vi.fn().mockResolvedValue(catalog),
      getInstalledPlugins: vi.fn().mockImplementation(async () => installedPlugins),
      getGlobalMcpServers: vi.fn().mockResolvedValue([]),
      deleteInstalledPlugin,
    } as unknown as Window["desktop"]

    const { result } = renderHook(
      () => useSettingsPage({ isPluginsPageOpen: true }),
      { wrapper },
    )

    await waitFor(() => expect(result.current.installedPlugins).toHaveLength(1))

    act(() => {
      result.current.selectPlugin("filesystem")
    })
    expect(result.current.activePluginID).toBe("filesystem")

    await act(async () => {
      await expect(result.current.deleteInstalledPlugin("filesystem")).resolves.toBe(true)
    })

    await waitFor(() => expect(result.current.installedPlugins).toHaveLength(0))
    expect(deleteInstalledPlugin).toHaveBeenCalledWith({ pluginID: "filesystem" })
    expect(result.current.activePluginID).toBe("filesystem")
    expect(result.current.pluginDraft).toEqual({
      pluginID: "filesystem",
      config: {
        ROOT_PATH: "",
      },
      appApiKeys: {},
    })
  })

  it("saves plugin MCP enablement and tool policies through the ownership-checked API", async () => {
    const plugin = createPlugin("filesystem", "Filesystem")
    const installed = {
      ...createInstalledPlugin("filesystem"),
      mcpServerIDs: ["plugin.filesystem"],
      mcpServerEnabled: {
        "plugin.filesystem": true,
      },
    }
    const server = {
      id: "plugin.filesystem",
      name: "Filesystem",
      owner: {
        kind: "plugin" as const,
        pluginID: "filesystem",
        bindingID: "mcp:default",
      },
      transport: "stdio" as const,
      command: "node",
      toolPolicies: {
        read_file: {
          policy: "ask" as const,
        },
      },
      enabled: true,
    }
    const updateInstalledPluginMcpControls = vi.fn().mockResolvedValue({
      plugin: installed,
      server,
    })

    window.desktop = {
      getPluginCatalog: vi.fn().mockResolvedValue([plugin]),
      getInstalledPlugins: vi.fn().mockResolvedValue([installed]),
      getGlobalMcpServers: vi.fn().mockResolvedValue([server]),
      updateInstalledPluginMcpControls,
    } as unknown as Window["desktop"]

    const { result } = renderHook(
      () => useSettingsPage({
        isMcpServersPageOpen: true,
        isPluginsPageOpen: true,
      }),
      { wrapper },
    )

    await waitFor(() => expect(result.current.mcpServers).toHaveLength(1))

    await act(async () => {
      await expect(
        result.current.setInstalledPluginMcpEnabled("filesystem", "plugin.filesystem", false),
      ).resolves.toBe(true)
    })
    expect(updateInstalledPluginMcpControls).toHaveBeenCalledWith({
      pluginID: "filesystem",
      serverID: "plugin.filesystem",
      enabled: false,
    })

    await act(async () => {
      await expect(
        result.current.setInstalledPluginMcpToolPolicy(
          "filesystem",
          "plugin.filesystem",
          "write_file",
          "disabled",
        ),
      ).resolves.toBe(true)
    })
    expect(updateInstalledPluginMcpControls).toHaveBeenLastCalledWith({
      pluginID: "filesystem",
      serverID: "plugin.filesystem",
      toolPolicies: {
        read_file: {
          policy: "ask",
        },
        write_file: {
          policy: "disabled",
        },
      },
    })
  })

  it("loads the MCP inventory when the plugins page opens", async () => {
    const plugin = createPlugin("filesystem", "Filesystem")
    const installed = {
      ...createInstalledPlugin("filesystem"),
      mcpServerIDs: ["plugin.filesystem"],
      mcpServerEnabled: {
        "plugin.filesystem": true,
      },
    }
    const server = createPluginMcpServer("filesystem", "Filesystem")
    const getGlobalMcpServers = vi.fn().mockResolvedValue([server])

    window.desktop = {
      getPluginCatalog: vi.fn().mockResolvedValue([plugin]),
      getInstalledPlugins: vi.fn().mockResolvedValue([installed]),
      getGlobalMcpServers,
    } as unknown as Window["desktop"]

    const { result } = renderHook(
      () => useSettingsPage({ isPluginsPageOpen: true }),
      { wrapper },
    )

    await waitFor(() => expect(result.current.mcpServers).toEqual([server]))
    expect(getGlobalMcpServers).toHaveBeenCalledTimes(1)
  })

  it("keeps the last complete plugin snapshot when the remote catalog cannot be reloaded", async () => {
    const plugin = createPlugin("filesystem", "Filesystem")
    const installed = createInstalledPlugin("filesystem")
    const getPluginCatalog = vi.fn()
      .mockResolvedValueOnce([plugin])
      .mockRejectedValueOnce(new Error("[PLUGIN_REGISTRY_UNAVAILABLE] remote registry is invalid"))

    window.desktop = {
      getPluginCatalog,
      getInstalledPlugins: vi.fn().mockResolvedValue([installed]),
      getGlobalMcpServers: vi.fn().mockResolvedValue([]),
    } as unknown as Window["desktop"]

    const { result } = renderHook(
      () => useSettingsPage({ isPluginsPageOpen: true }),
      { wrapper },
    )

    await waitFor(() => expect(result.current.pluginCatalog).toEqual([plugin]))
    act(() => {
      result.current.selectPlugin("filesystem")
    })

    await act(async () => {
      await result.current.loadPlugins()
    })

    expect(result.current.pluginCatalog).toEqual([plugin])
    expect(result.current.installedPlugins).toEqual([installed])
    expect(result.current.activePluginID).toBe("filesystem")
    expect(result.current.pluginsError).toBe(
      "The latest plugin catalog could not be loaded from GitHub. Check GitHub access, then retry.",
    )
    expect(getPluginCatalog).toHaveBeenCalledTimes(2)
    expect(getPluginCatalog).toHaveBeenNthCalledWith(1, { freshness: "fresh" })
    expect(getPluginCatalog).toHaveBeenNthCalledWith(2, { freshness: "fresh" })
  })

  it("still exposes installed plugins when the remote catalog is invalid on first load", async () => {
    const installed = createInstalledPlugin("filesystem")
    window.desktop = {
      getPluginCatalog: vi.fn()
        .mockRejectedValue(new Error("[PLUGIN_REGISTRY_UNAVAILABLE] remote registry is invalid")),
      getInstalledPlugins: vi.fn().mockResolvedValue([installed]),
      getGlobalMcpServers: vi.fn().mockResolvedValue([]),
    } as unknown as Window["desktop"]

    const { result } = renderHook(
      () => useSettingsPage({ isPluginsPageOpen: true }),
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current.pluginsError).toBe(
        "The latest plugin catalog could not be loaded from GitHub. Check GitHub access, then retry.",
      )
    })
    expect(result.current.installedPlugins).toEqual([installed])
    expect(result.current.pluginCatalog).toEqual([
      expect.objectContaining({
        id: "filesystem",
        installable: false,
        source: "package",
      }),
    ])
  })

  it("refreshes plugin data and MCP inventory after install, update, and uninstall", async () => {
    const plugin = createPlugin("filesystem", "Filesystem")
    const installed = {
      ...createInstalledPlugin("filesystem"),
      mcpServerIDs: ["plugin.filesystem"],
      mcpServerEnabled: {
        "plugin.filesystem": true,
      },
    }
    const server = createPluginMcpServer("filesystem", "Filesystem")
    let installedPlugins: InstalledPlugin[] = []
    let mcpServers: McpServerSummary[] = []
    const getGlobalMcpServers = vi.fn().mockImplementation(async () => mcpServers)
    const installPlugin = vi.fn().mockImplementation(async () => {
      installedPlugins = [installed]
      mcpServers = [server]
      return installed
    })
    const updateInstalledPlugin = vi.fn().mockImplementation(async (input: { enabled?: boolean }) => {
      const updated = {
        ...installed,
        enabled: input.enabled ?? installed.enabled,
      }
      installedPlugins = [updated]
      mcpServers = [{
        ...server,
        enabled: updated.enabled,
      }]
      return updated
    })
    const deleteInstalledPlugin = vi.fn().mockImplementation(async () => {
      installedPlugins = []
      mcpServers = []
    })

    window.desktop = {
      getPluginCatalog: vi.fn().mockResolvedValue([plugin]),
      getInstalledPlugins: vi.fn().mockImplementation(async () => installedPlugins),
      getGlobalMcpServers,
      installPlugin,
      updateInstalledPlugin,
      deleteInstalledPlugin,
    } as unknown as Window["desktop"]

    const { result } = renderHook(
      () => useSettingsPage({ isPluginsPageOpen: true }),
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current.pluginCatalog).toEqual([plugin])
      expect(getGlobalMcpServers).toHaveBeenCalled()
    })
    getGlobalMcpServers.mockClear()

    await act(async () => {
      await expect(result.current.installPlugin("filesystem")).resolves.toBe(true)
    })
    expect(getGlobalMcpServers).toHaveBeenCalledTimes(1)
    expect(result.current.installedPlugins).toEqual([installed])
    expect(result.current.mcpServers).toEqual([server])

    getGlobalMcpServers.mockClear()
    await act(async () => {
      await expect(result.current.setInstalledPluginEnabled("filesystem", false)).resolves.toBe(true)
    })
    expect(getGlobalMcpServers).toHaveBeenCalledTimes(1)
    expect(result.current.installedPlugins[0]?.enabled).toBe(false)
    expect(result.current.mcpServers[0]?.enabled).toBe(false)

    getGlobalMcpServers.mockClear()
    await act(async () => {
      await expect(result.current.deleteInstalledPlugin("filesystem")).resolves.toBe(true)
    })
    expect(getGlobalMcpServers).toHaveBeenCalledTimes(1)
    expect(result.current.installedPlugins).toEqual([])
    expect(result.current.mcpServers).toEqual([])
  })
})
