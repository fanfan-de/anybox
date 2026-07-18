import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ToastProvider } from "./toast"
import type { InstalledPlugin, PluginCatalogItem } from "./types"
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
    connectorRequirementIDs: [],
    config: {
      ROOT_PATH: "C:\\Projects",
    },
    installedAt: 1,
    updatedAt: 2,
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
})
