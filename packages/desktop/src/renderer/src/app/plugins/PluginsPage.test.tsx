import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import type { ComponentProps } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { PluginsPage } from "./PluginsPage"
import { I18nProvider } from "../i18n/I18nProvider"

type PluginsPageProps = ComponentProps<typeof PluginsPage>
type CatalogPlugin = PluginsPageProps["pluginCatalog"][number]
type InstalledPlugin = PluginsPageProps["installedPlugins"][number]
type McpDiagnostic = PluginsPageProps["pluginDiagnostics"][string]

function createPlugin(overrides: Partial<CatalogPlugin> = {}): CatalogPlugin {
  const id = overrides.id ?? "filesystem"

  return {
    id,
    name: overrides.name ?? "Filesystem",
    description: overrides.description ?? "Expose a local directory to MCP.",
    longDescription: overrides.longDescription,
    version: overrides.version ?? "1.0.0",
    publisher: overrides.publisher ?? "Anybox",
    category: overrides.category ?? "Code",
    iconUrl: overrides.iconUrl,
    thumbnailUrl: overrides.thumbnailUrl,
    heroImageUrl: overrides.heroImageUrl,
    screenshots: overrides.screenshots ?? [],
    tags: overrides.tags ?? [],
    brandColor: overrides.brandColor,
    risk: overrides.risk ?? "high",
    permissions: overrides.permissions ?? ["Read access inside the configured root path"],
    tools: overrides.tools ?? [
      {
        name: "read_file",
        title: "Read File",
        description: "Read files below the configured root.",
        readOnly: true,
      },
    ],
    mcpServers: overrides.mcpServers ?? [
      {
        id: "default",
        name: "Filesystem",
        description: "Expose local files.",
        risk: "high",
        permissions: ["Read access inside the configured root path"],
        tools: [
          {
            name: "read_file",
            description: "Read files below the configured root.",
            readOnly: true,
          },
        ],
        runtime: {
          transport: "stdio",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", "${ROOT_PATH}"],
          timeoutMs: 30000,
        },
      },
    ],
    mcpRequirements: overrides.mcpRequirements ?? [],
    skills: overrides.skills ?? [],
    connectorRequirements: overrides.connectorRequirements ?? [],
    connectors: overrides.connectors ?? overrides.apps ?? [],
    apps: overrides.apps ?? [],
    configFields: overrides.configFields ?? [
      {
        key: "ROOT_PATH",
        label: "Root path",
        type: "path",
        required: true,
      },
    ],
    installReview: overrides.installReview ?? ["Prefer a narrow project folder."],
    ...overrides,
  }
}

function createDocsPlugin(): CatalogPlugin {
  return createPlugin({
    id: "docs",
    name: "Docs",
    description: "Search connected documentation.",
    category: "Docs",
    risk: "medium",
    configFields: [],
    tools: [
      {
        name: "search_docs",
        title: "Search Docs",
        description: "Search docs.",
        readOnly: true,
      },
    ],
    mcpServers: [],
    skills: [
      {
        id: "plugin:docs:review",
        name: "Review Docs",
        description: "Review documentation output.",
        directory: "review",
      },
    ],
    apps: [
      {
        appID: "docs-api",
        name: "Docs API",
        description: "Remote docs connector.",
        credential: {
          key: "DOCS_API_KEY",
          label: "Docs API key",
          type: "password",
          required: true,
          secret: true,
        },
        runtime: {
          transport: "remote",
          serverUrl: "https://docs.example.test/mcp",
          allowedTools: {
            readOnly: true,
          },
          requireApproval: "always",
          timeoutMs: 30000,
        },
      },
    ],
    permissions: ["Sends requests to docs.example.test"],
    installReview: ["API keys are injected only at runtime."],
  })
}

function createOAuthPlugin(): CatalogPlugin {
  return createPlugin({
    id: "mail",
    name: "Mail",
    description: "Read connected mail.",
    category: "Docs",
    risk: "medium",
    configFields: [],
    tools: [],
    mcpServers: [],
    skills: [],
    apps: [
      {
        appID: "gmail",
        name: "Gmail",
        description: "Read Gmail over OAuth.",
        credential: {
          kind: "oauth",
          label: "Google account",
          clientID: "client",
          authorizationURL: "https://accounts.example.test/authorize",
          tokenURL: "https://accounts.example.test/token",
          scopes: ["gmail.readonly"],
        },
        runtime: {
          transport: "remote",
          serverUrl: "https://gmail.example.test/mcp",
          allowedTools: {
            readOnly: true,
          },
          requireApproval: "never",
        },
      },
    ],
    permissions: ["Reads mail metadata"],
    installReview: [],
  })
}

function createInstalledPlugin(overrides: Partial<InstalledPlugin> = {}): InstalledPlugin {
  return {
    pluginID: overrides.pluginID ?? "filesystem",
    version: overrides.version ?? "1.0.0",
    enabled: overrides.enabled ?? true,
    mcpServerID: overrides.mcpServerID ?? "plugin.filesystem",
    mcpServerIDs: overrides.mcpServerIDs ?? ["plugin.filesystem"],
    mcpServerEnabled: overrides.mcpServerEnabled ?? {
      "plugin.filesystem": true,
    },
    skillIDs: overrides.skillIDs ?? [],
    connectorIDs: overrides.connectorIDs ?? [],
    mcpRequirementIDs: overrides.mcpRequirementIDs ?? [],
    connectorRequirementIDs: overrides.connectorRequirementIDs ?? [],
    config: overrides.config ?? {
      ROOT_PATH: "C:\\Projects",
    },
    installedAt: overrides.installedAt ?? 1,
    updatedAt: overrides.updatedAt ?? 2,
    lastDiagnostic: overrides.lastDiagnostic,
    lastConnectorDiagnostics: overrides.lastConnectorDiagnostics,
    packageRoot: overrides.packageRoot,
    missingPackage: overrides.missingPackage,
  }
}

function createDiagnostic(overrides: Partial<McpDiagnostic> = {}): McpDiagnostic {
  return {
    serverID: overrides.serverID ?? "plugin.filesystem",
    enabled: overrides.enabled ?? true,
    ok: overrides.ok ?? true,
    toolCount: overrides.toolCount ?? 1,
    toolNames: overrides.toolNames ?? ["read_file"],
    tools: overrides.tools ?? [],
    error: overrides.error,
  }
}

function createProps(overrides: Partial<PluginsPageProps> = {}): PluginsPageProps {
  return {
    activePluginID: null,
    deletingPluginID: null,
    diagnosingPluginConnectorID: null,
    diagnosingPluginID: null,
    diagnosingMcpServerID: null,
    installingPluginID: null,
    installedPlugins: [],
    isLoading: false,
    loadError: null,
    connectorStatuses: [],
    pluginCatalog: [createPlugin()],
    pluginConnectorStatuses: {},
    pluginDiagnostics: {},
    pluginDraft: {
      pluginID: null,
      config: {},
      appApiKeys: {},
    },
    mcpDiagnostics: {},
    mcpServers: [],
    savingPluginConnectorID: null,
    savingMcpServerID: null,
    updatingPluginID: null,
    onCancelInstalledPluginConnectorAuthFlow: vi.fn(),
    onDeleteInstalledPlugin: vi.fn(),
    onDeleteInstalledPluginConnectorApiKey: vi.fn(),
    onDeleteInstalledPluginConnectorAuthSession: vi.fn(),
    onDiagnoseInstalledPlugin: vi.fn(),
    onDiagnoseInstalledPluginConnector: vi.fn(),
    onDiagnoseMcpServer: vi.fn(),
    onImportPluginFromURL: vi.fn(),
    onInstallPlugin: vi.fn(),
    onPluginDraftAppApiKeyChange: vi.fn(),
    onPluginDraftConfigChange: vi.fn(),
    onPluginDeselect: vi.fn(),
    onPluginSelect: vi.fn(),
    onSaveInstalledPluginConnectorApiKey: vi.fn(),
    onSaveInstalledPluginConfig: vi.fn(),
    onSetInstalledPluginEnabled: vi.fn(),
    onSetInstalledPluginMcpEnabled: vi.fn(),
    onSetInstalledPluginMcpToolPolicy: vi.fn(),
    onStartInstalledPluginConnectorAuthFlow: vi.fn(),
    ...overrides,
  }
}

describe("PluginsPage", () => {
  beforeEach(() => {
    window.desktop = undefined
    window.localStorage.removeItem("desktop.locale")
  })

  it("renders the plugin marketplace without the development blocker", () => {
    const onInstallPlugin = vi.fn()
    render(<PluginsPage {...createProps({ onInstallPlugin })} />)

    expect(screen.getByRole("region", { name: "Plugin marketplace layout" })).toBeInTheDocument()
    expect(screen.queryByLabelText("Featured plugin spotlight")).not.toBeInTheDocument()
    expect(screen.queryByText("Plugin module is under development")).not.toBeInTheDocument()
    expect(screen.queryByRole("navigation", { name: "Plugin detail breadcrumb" })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Install Filesystem" }))
    expect(screen.getByRole("dialog", { name: "Review Filesystem" })).toBeInTheDocument()
    expect(screen.getByText("Prefer a narrow project folder.")).toBeInTheDocument()
    expect(onInstallPlugin).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Confirm install Filesystem" }))
    expect(onInstallPlugin).toHaveBeenCalledWith("filesystem")
  })

  it("does not expose Chrome launching in the installed plugin detail", () => {
    const chrome = createPlugin({
      id: "chrome",
      name: "Chrome",
      category: "Browser",
      configFields: [],
      mcpServers: [],
      skills: [],
      apps: [],
      connectorRequirements: [],
    })

    render(
      <PluginsPage
        {...createProps({
          activePluginID: "chrome",
          pluginCatalog: [chrome],
          installedPlugins: [
            createInstalledPlugin({
              pluginID: "chrome",
              mcpServerID: undefined,
              mcpServerIDs: [],
              mcpServerEnabled: {},
              config: {},
            }),
          ],
        })}
      />,
    )

    expect(screen.getByRole("heading", { name: "Chrome" })).toBeInTheDocument()
    expect(screen.queryByText("Chrome connection")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Open Chrome" })).not.toBeInTheDocument()
  })

  it("imports a plugin URL from the marketplace toolbar", async () => {
    const onImportPluginFromURL = vi.fn().mockResolvedValue(true)
    render(<PluginsPage {...createProps({ onImportPluginFromURL })} />)

    fireEvent.click(screen.getByRole("button", { name: "Import URL" }))

    const dialog = screen.getByRole("dialog", { name: "Import plugin URL" })
    const urlInput = within(dialog).getByLabelText("Plugin URL")
    fireEvent.change(urlInput, {
      target: {
        value: "https://example.test/.anybox-plugin/plugin.json",
      },
    })
    fireEvent.click(within(dialog).getByRole("button", { name: "Import" }))

    await waitFor(() => {
      expect(onImportPluginFromURL).toHaveBeenCalledWith("https://example.test/.anybox-plugin/plugin.json")
    })
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Import plugin URL" })).not.toBeInTheDocument()
    })
  })

  it("recommends every Anybox plugin and keeps other publishers in category sections", () => {
    const partnerPlugin = createPlugin({
      id: "partner",
      name: "Partner",
      description: "Connect a partner service.",
      publisher: "Partner Inc.",
    })

    render(
      <PluginsPage
        {...createProps({
          installedPlugins: [createInstalledPlugin({ pluginID: "partner" })],
          pluginCatalog: [
            createPlugin(),
            createDocsPlugin(),
            createPlugin({
              id: "designer",
              name: "Designer",
              description: "Create design assets.",
              category: "Design",
              configFields: [],
              mcpServers: [],
            }),
            createPlugin({
              id: "calendar",
              name: "Calendar",
              description: "Manage calendar items.",
              category: "Automation",
              configFields: [],
              mcpServers: [],
            }),
            partnerPlugin,
          ],
        })}
      />,
    )

    const categoryNav = screen.getByRole("navigation", { name: "Plugin categories" })
    const allCategoryButton = within(categoryNav).getByRole("button", { name: "All, 5 plugins" })
    expect(allCategoryButton).toHaveAttribute("aria-pressed", "true")
    expect(allCategoryButton).toHaveTextContent(/^All$/)
    expect(screen.queryByRole("region", { name: "Plugin promotion" })).not.toBeInTheDocument()
    expect(screen.getByRole("region", { name: "Featured plugins" })).toBeInTheDocument()
    const featuredList = screen.getByRole("list", { name: "Featured" })
    expect(within(featuredList).getAllByRole("listitem")).toHaveLength(4)
    expect(within(featuredList).getByRole("button", { name: "Filesystem not installed" })).toBeInTheDocument()
    expect(within(featuredList).getByRole("button", { name: "Docs not installed" })).toBeInTheDocument()
    expect(within(featuredList).getByRole("button", { name: "Designer not installed" })).toBeInTheDocument()
    expect(within(featuredList).getByRole("button", { name: "Calendar not installed" })).toBeInTheDocument()
    expect(within(featuredList).queryByRole("button", { name: "Partner installed enabled" })).not.toBeInTheDocument()
    expect(within(screen.getByRole("list", { name: "Code" })).getByRole("button", {
      name: "Partner installed enabled",
    })).toBeInTheDocument()

    fireEvent.click(within(categoryNav).getByRole("button", { name: "Docs, 1 plugin" }))

    expect(within(categoryNav).getByRole("button", { name: "Docs, 1 plugin" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "Docs not installed" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Filesystem not installed" })).not.toBeInTheDocument()

    fireEvent.click(within(categoryNav).getByRole("button", { name: "All, 5 plugins" }))

    expect(within(categoryNav).getByRole("button", { name: "All, 5 plugins" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "Filesystem not installed" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Docs not installed" })).toBeInTheDocument()
  })

  it("does not recommend installed plugins from other publishers", () => {
    const partnerPlugin = createPlugin({
      id: "partner",
      name: "Partner",
      publisher: "Partner Inc.",
    })

    render(
      <PluginsPage
        {...createProps({
          installedPlugins: [createInstalledPlugin({ pluginID: "partner" })],
          pluginCatalog: [partnerPlugin],
        })}
      />,
    )

    expect(screen.queryByRole("region", { name: "Featured plugins" })).not.toBeInTheDocument()
    expect(within(screen.getByRole("list", { name: "Code" })).getByRole("button", {
      name: "Partner installed enabled",
    })).toBeInTheDocument()
  })

  it("localizes marketplace category chips and card metadata in English", () => {
    render(
      <PluginsPage
        {...createProps({
          installedPlugins: [createInstalledPlugin()],
          pluginCatalog: [
            createPlugin({
              source: "package",
            }),
          ],
        })}
      />,
    )

    expect(screen.getByText("By Anybox")).toBeInTheDocument()
    expect(screen.getAllByText("Code").length).toBeGreaterThan(0)
    expect(screen.getByText("1 capability")).toBeInTheDocument()
    expect(screen.getByText("Local package")).toBeInTheDocument()
    expect(screen.getAllByText("Installed").length).toBeGreaterThan(0)
    expect(screen.queryByText("由 Anybox 开发")).not.toBeInTheDocument()
    expect(screen.queryByText("开发")).not.toBeInTheDocument()
    expect(screen.queryByText("1 项能力")).not.toBeInTheDocument()
    expect(screen.queryByText("本地包")).not.toBeInTheDocument()
    expect(screen.queryByText("已安装")).not.toBeInTheDocument()
  })

  it("localizes the browser category in Chinese", () => {
    window.localStorage.setItem("desktop.locale", "zh-CN")

    render(
      <I18nProvider>
        <PluginsPage
          {...createProps({
            pluginCatalog: [
              createPlugin({
                category: "Browser",
              }),
            ],
          })}
        />
      </I18nProvider>,
    )

    const categoryNav = screen.getByRole("navigation", { name: "插件分类" })
    expect(within(categoryNav).getByRole("button", { name: "浏览器，1 个插件" })).toBeInTheDocument()
    expect(within(categoryNav).queryByRole("button", { name: "Browser，1 个插件" })).not.toBeInTheDocument()
  })

  it("uses localized plugin descriptions for the active app locale", () => {
    window.localStorage.setItem("desktop.locale", "zh-CN")
    const calendarPlugin = createPlugin({
      id: "calendar",
      name: "Calendar",
      description: "Manage Anybox Calendar items.",
      longDescription: "Manage Anybox Calendar items from the plugin marketplace.",
      category: "Automation",
      localized: {
        name: {
          "en-US": "Calendar",
          "zh-CN": "日历",
        },
        description: {
          "en-US": "Manage Anybox Calendar items.",
          "zh-CN": "管理 Anybox 日历事项。",
        },
        longDescription: {
          "en-US": "Manage Anybox Calendar items from the plugin marketplace.",
          "zh-CN": "在插件市场中管理 Anybox 日历事项。",
        },
      },
    })
    const props = createProps({
      pluginCatalog: [calendarPlugin],
    })
    const { rerender } = render(
      <I18nProvider>
        <PluginsPage {...props} />
      </I18nProvider>,
    )

    expect(screen.getByRole("button", { name: "日历 未安装" })).toBeInTheDocument()
    expect(screen.getByText("管理 Anybox 日历事项。")).toBeInTheDocument()

    rerender(
      <I18nProvider>
        <PluginsPage {...props} activePluginID="calendar" />
      </I18nProvider>,
    )

    expect(screen.getByRole("heading", { name: "日历", level: 1 })).toBeInTheDocument()
    expect(screen.getByText("在插件市场中管理 Anybox 日历事项。")).toBeInTheDocument()
    expect(screen.queryByText("Manage Anybox Calendar items.")).not.toBeInTheDocument()
  })

  it("lists installed plugins in the installed sidebar", () => {
    const onPluginSelect = vi.fn()

    render(
      <PluginsPage
        {...createProps({
          installedPlugins: [createInstalledPlugin()],
          onPluginSelect,
        })}
      />,
    )

    const installedSidebar = screen.getByRole("complementary", { name: "Installed plugins" })
    expect(installedSidebar).toBeInTheDocument()
    const installedHeading = within(installedSidebar).getByRole("heading", { name: "Installed" })
    expect(installedHeading.parentElement).toHaveTextContent(/^Installed$/)
    const installedButton = within(installedSidebar).getByRole("button", { name: "Filesystem installed enabled" })
    fireEvent.click(installedButton)

    expect(onPluginSelect).toHaveBeenCalledWith("filesystem")
  })

  it("keeps image logos unpainted and falls back to neutral initials when an image fails", () => {
    const chromeIcon = "data:image/svg+xml;base64,PHN2Zy8+"

    render(
      <PluginsPage
        {...createProps({
          installedPlugins: [
            createInstalledPlugin(),
            createInstalledPlugin({
              pluginID: "chrome",
            }),
          ],
          pluginCatalog: [
            createPlugin(),
            createPlugin({
              id: "chrome",
              name: "Chrome",
              iconUrl: chromeIcon,
            }),
          ],
        })}
      />,
    )

    const installedSidebar = screen.getByRole("complementary", { name: "Installed plugins" })
    const initials = installedSidebar.querySelector(".plugins-icon-initials")
    const logoImage = installedSidebar.querySelector(`img[src="${chromeIcon}"]`)

    expect(initials?.closest(".plugins-icon-mark")).toHaveClass("is-placeholder")
    expect(logoImage?.closest(".plugins-icon-mark")).toHaveClass("is-logo-image")
    expect(logoImage?.closest(".plugins-icon-mark")).not.toHaveClass("is-placeholder")

    fireEvent.error(logoImage!)

    expect(installedSidebar.querySelector(`img[src="${chromeIcon}"]`)).toBeNull()
    expect(within(installedSidebar).getByText("CH").closest(".plugins-icon-mark")).toHaveClass("is-placeholder")
  })

  it("opens installed plugin local files from the sidebar context menu", async () => {
    const getStoragePaths = vi.fn().mockResolvedValue({
      installedPlugins: "C:\\Users\\tester\\AppData\\Roaming\\Anybox\\agent\\data\\plugins\\installed",
    })
    const openPath = vi.fn().mockResolvedValue({
      ok: true,
      targetPath: "C:\\Users\\tester\\AppData\\Roaming\\Anybox\\agent\\data\\plugins\\installed\\filesystem",
    })
    window.desktop = {
      getStoragePaths,
      openPath,
    } as unknown as Window["desktop"]

    render(
      <PluginsPage
        {...createProps({
          installedPlugins: [createInstalledPlugin()],
        })}
      />,
    )

    const installedSidebar = screen.getByRole("complementary", { name: "Installed plugins" })
    fireEvent.contextMenu(within(installedSidebar).getByRole("button", { name: "Filesystem installed enabled" }), {
      clientX: 48,
      clientY: 64,
    })

    expect(screen.getByRole("menu", { name: "Filesystem actions" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("menuitem", { name: "Open local files" }))

    await waitFor(() => {
      expect(openPath).toHaveBeenCalledWith({
        targetPath: "C:\\Users\\tester\\AppData\\Roaming\\Anybox\\agent\\data\\plugins\\installed\\filesystem",
      })
    })
    expect(getStoragePaths).toHaveBeenCalledTimes(1)
  })

  it("opens installed plugin package roots when the agent reports the real package path", async () => {
    const packageRoot = "C:\\Users\\tester\\AppData\\Roaming\\Anybox\\agent\\data\\plugins\\installed\\presentations\\0.1.1"
    const getStoragePaths = vi.fn().mockResolvedValue({
      installedPlugins: "C:\\Users\\tester\\AppData\\Roaming\\Anybox\\agent\\data\\plugins\\installed",
    })
    const openPath = vi.fn().mockResolvedValue({
      ok: true,
      targetPath: packageRoot,
    })
    window.desktop = {
      getStoragePaths,
      openPath,
    } as unknown as Window["desktop"]

    render(
      <PluginsPage
        {...createProps({
          installedPlugins: [
            createInstalledPlugin({
              pluginID: "presentations",
              packageRoot,
            }),
          ],
        })}
      />,
    )

    const installedSidebar = screen.getByRole("complementary", { name: "Installed plugins" })
    fireEvent.contextMenu(within(installedSidebar).getByRole("button", { name: "Presentations installed enabled" }), {
      clientX: 48,
      clientY: 64,
    })
    fireEvent.click(screen.getByRole("menuitem", { name: "Open local files" }))

    await waitFor(() => {
      expect(openPath).toHaveBeenCalledWith({ targetPath: packageRoot })
    })
    expect(getStoragePaths).not.toHaveBeenCalled()
  })

  it("does not open local files for installed plugins with missing packages", () => {
    const getStoragePaths = vi.fn().mockResolvedValue({
      installedPlugins: "C:\\Users\\tester\\AppData\\Roaming\\Anybox\\agent\\data\\plugins\\installed",
    })
    const openPath = vi.fn().mockResolvedValue({
      ok: true,
      targetPath: "C:\\Users\\tester\\AppData\\Roaming\\Anybox\\agent\\data\\plugins\\installed\\filesystem",
    })
    window.desktop = {
      getStoragePaths,
      openPath,
    } as unknown as Window["desktop"]

    render(
      <PluginsPage
        {...createProps({
          installedPlugins: [
            createInstalledPlugin({
              missingPackage: true,
            }),
          ],
        })}
      />,
    )

    const installedSidebar = screen.getByRole("complementary", { name: "Installed plugins" })
    fireEvent.contextMenu(within(installedSidebar).getByRole("button", { name: "Filesystem Download required" }), {
      clientX: 48,
      clientY: 64,
    })

    expect(screen.getByRole("menuitem", { name: "Open local files" })).toBeDisabled()
    expect(openPath).not.toHaveBeenCalled()
    expect(getStoragePaths).not.toHaveBeenCalled()
  })

  it("shows installed plugins even when catalog metadata is missing", () => {
    render(
      <PluginsPage
        {...createProps({
          installedPlugins: [
            createInstalledPlugin({
              pluginID: "local-helper",
              version: "2.1.0",
            }),
          ],
          pluginCatalog: [],
        })}
      />,
    )

    expect(screen.getByRole("button", { name: "Local Helper installed enabled" })).toBeInTheDocument()
    expect(screen.getByText("v2.1.0")).toBeInTheDocument()
    expect(screen.queryByText("Enabled - v2.1.0")).not.toBeInTheDocument()
  })

  it("keeps the current catalog visible beside a retryable load error", () => {
    const onRetryLoad = vi.fn()
    render(
      <PluginsPage
        {...createProps({
          loadError: "The remote plugin catalog could not be loaded.",
          onRetryLoad,
        })}
      />,
    )

    expect(screen.getByRole("button", { name: "Filesystem not installed" })).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent("The remote plugin catalog could not be loaded.")
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(onRetryLoad).toHaveBeenCalledTimes(1)
  })

  it("opens selected plugin details as a second-level view and returns to the marketplace", () => {
    const onInstallPlugin = vi.fn()
    const onPluginDeselect = vi.fn()
    const onPluginSelect = vi.fn()
    const { rerender } = render(
      <PluginsPage
        {...createProps({
          onInstallPlugin,
          onPluginDeselect,
          onPluginSelect,
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Filesystem not installed" }))
    expect(onPluginSelect).toHaveBeenCalledWith("filesystem")

    rerender(
      <PluginsPage
        {...createProps({
          activePluginID: "filesystem",
          onInstallPlugin,
          onPluginDeselect,
          onPluginSelect,
        })}
      />,
    )

    expect(screen.queryByRole("region", { name: "Plugin marketplace layout" })).not.toBeInTheDocument()
    expect(screen.getByRole("region", { name: "Selected plugin details" })).toBeInTheDocument()
    const breadcrumb = screen.getByRole("navigation", { name: "Plugin detail breadcrumb" })
    expect(breadcrumb).toHaveTextContent("Plugins")
    expect(breadcrumb).not.toHaveTextContent("Filesystem")
    expect(screen.getByLabelText("Plugins top menu")).not.toContainElement(breadcrumb)
    expect(breadcrumb.closest(".plugins-page-main")).not.toBeNull()
    const detailColumn = breadcrumb.closest(".plugins-marketplace-content")
    expect(detailColumn).not.toBeNull()
    expect(screen.getByRole("complementary", { name: "Installed plugins" })).not.toContainElement(breadcrumb)
    expect(screen.getByRole("heading", { name: "Filesystem", level: 1 })).toBeInTheDocument()
    expect(screen.queryByLabelText("Filesystem example prompts")).not.toBeInTheDocument()
    const installButton = screen.getByRole("button", { name: "Install Filesystem" })
    expect(installButton.closest(".plugins-detail-actions")).not.toBeNull()
    fireEvent.click(installButton)
    fireEvent.click(screen.getByRole("button", { name: "Confirm install Filesystem" }))
    expect(onInstallPlugin).toHaveBeenCalledWith("filesystem")

    fireEvent.click(within(breadcrumb).getByRole("button", { name: "Plugins" }))
    expect(onPluginDeselect).toHaveBeenCalledTimes(1)
  })

  it("filters plugins by external search and category navigation and selects a plugin from the list", () => {
    const onPluginSelect = vi.fn()
    render(
      <PluginsPage
        {...createProps({
          pluginCatalog: [
            createPlugin(),
            createDocsPlugin(),
          ],
          searchQuery: "docs",
          onPluginSelect,
        })}
      />,
    )

    expect(screen.getByRole("button", { name: "Docs not installed" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Filesystem not installed" })).not.toBeInTheDocument()

    const categoryNav = screen.getByRole("navigation", { name: "Plugin categories" })
    fireEvent.click(within(categoryNav).getByRole("button", { name: "Docs, 1 plugin" }))
    expect(screen.getByRole("button", { name: "Docs not installed" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Docs not installed" }))
    expect(onPluginSelect).toHaveBeenCalledWith("docs")
  })

  it("can be embedded with an external search field", () => {
    render(
      <PluginsPage
        {...createProps({
          hideTopMenu: true,
          pluginCatalog: [createPlugin(), createDocsPlugin()],
          searchQuery: "docs",
        })}
      />,
    )

    expect(screen.queryByLabelText("Plugins top menu")).not.toBeInTheDocument()
    expect(screen.queryByRole("searchbox", { name: "Search" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Docs not installed" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Filesystem not installed" })).not.toBeInTheDocument()
  })

  it("renders rich marketplace metadata in plugin details", () => {
    const imageUrl = "https://cdn.example.test/filesystem.png"
    render(
      <PluginsPage
        {...createProps({
          activePluginID: "filesystem",
          pluginCatalog: [
            createPlugin({
              longDescription: "A longer plugin marketplace description.",
              tags: ["files", "local"],
              thumbnailUrl: imageUrl,
              heroImageUrl: imageUrl,
              screenshots: [imageUrl],
              brandColor: "#112233",
            }),
          ],
        })}
      />,
    )

    expect(screen.getByText("A longer plugin marketplace description.")).toBeInTheDocument()
    expect(screen.getByText("files")).toBeInTheDocument()
    expect(screen.getByText("local")).toBeInTheDocument()
    expect(screen.getByAltText("Filesystem screenshot 1")).toHaveAttribute("src", imageUrl)
    expect(screen.getByText("#112233")).toBeInTheDocument()
  })

  it("renders plugin configuration fields before installation", () => {
    const onInstallPlugin = vi.fn()
    const onPluginDraftConfigChange = vi.fn()
    const plugin = {
      ...createOAuthPlugin(),
      id: "gmail",
      name: "Gmail",
      configFields: [
        {
          key: "GOOGLE_OAUTH_CLIENT_ID",
          label: "Google OAuth client ID",
          type: "text" as const,
          required: true,
          placeholder: "123.apps.googleusercontent.com",
          description: "OAuth client used for the Gmail connector.",
        },
      ],
    }

    render(
      <PluginsPage
        {...createProps({
          activePluginID: "gmail",
          pluginCatalog: [plugin],
          pluginDraft: {
            pluginID: "gmail",
            config: {
              GOOGLE_OAUTH_CLIENT_ID: "",
            },
            appApiKeys: {},
          },
          onInstallPlugin,
          onPluginDraftConfigChange,
        })}
      />,
    )

    const clientIDInput = screen.getByLabelText(/Google OAuth client ID/)
    expect(clientIDInput).toHaveAttribute("placeholder", "123.apps.googleusercontent.com")
    expect(screen.getByText("Required values are used when installing this plugin.")).toBeInTheDocument()

    fireEvent.change(clientIDInput, {
      target: {
        value: "client.apps.googleusercontent.com",
      },
    })
    expect(onPluginDraftConfigChange).toHaveBeenCalledWith(
      "GOOGLE_OAUTH_CLIENT_ID",
      "client.apps.googleusercontent.com",
    )

    fireEvent.click(screen.getByRole("button", { name: "Install Gmail" }))
    expect(onInstallPlugin).toHaveBeenCalledWith("gmail")
  })

  it("renders plugin info URLs as clickable desktop links", () => {
    const homepage = "https://example.test/filesystem"
    const documentationUrl = "https://docs.example.test/filesystem"
    const openExternalUrl = vi.fn().mockResolvedValue({
      ok: true,
      url: homepage,
    })
    window.desktop = {
      openExternalUrl,
    } as unknown as Window["desktop"]

    render(
      <PluginsPage
        {...createProps({
          activePluginID: "filesystem",
          pluginCatalog: [
            createPlugin({
              homepage,
              documentationUrl,
            }),
          ],
        })}
      />,
    )

    const homepageLink = screen.getByRole("link", { name: homepage })
    expect(homepageLink).toHaveAttribute("href", homepage)
    fireEvent.click(homepageLink)
    expect(openExternalUrl).toHaveBeenCalledWith({
      url: homepage,
    })

    const documentationLink = screen.getByRole("link", { name: documentationUrl })
    expect(documentationLink).toHaveAttribute("href", documentationUrl)
    fireEvent.click(documentationLink)
    expect(openExternalUrl).toHaveBeenCalledWith({
      url: documentationUrl,
    })
  })

  it("hides legacy management panels from selected plugin details", () => {
    const plugin = createDocsPlugin()
    const installed = createInstalledPlugin({
      pluginID: "docs",
      mcpServerID: "plugin.docs.app.docs-api",
      mcpServerIDs: ["plugin.docs.app.docs-api"],
      skillIDs: ["plugin:docs:review"],
      connectorIDs: ["plugin-app:docs:docs-api"],
      config: {},
    })
    render(
      <PluginsPage
        {...createProps({
          activePluginID: "docs",
          pluginCatalog: [plugin],
          installedPlugins: [installed],
          pluginConnectorStatuses: {
            docs: [
              {
                pluginID: "docs",
                appID: "docs-api",
                connectorID: "plugin-app:docs:docs-api",
                connected: true,
                credentialKind: "api_key",
                authStatus: "connected",
                credentialLabel: "Docs API key",
                generatedMcpServerID: "plugin.docs.app.docs-api",
                lastDiagnostic: createDiagnostic({
                  serverID: "plugin.docs.app.docs-api",
                  toolNames: ["search_docs"],
                }),
              },
            ],
          },
          pluginDiagnostics: {
            docs: createDiagnostic({
              serverID: "plugin.docs.app.docs-api",
              toolNames: ["search_docs"],
            }),
          },
        })}
      />,
    )

    expect(screen.getByRole("region", { name: "Selected plugin details" })).toBeInTheDocument()
    const installedStatus = screen.getByLabelText("Docs installed")
    expect(installedStatus).toHaveTextContent("Installed")
    expect(installedStatus.closest(".plugins-detail-actions")).not.toBeNull()
    expect(screen.getByRole("button", { name: "Uninstall Docs" })).toBeInTheDocument()
    expect(screen.getByText("Docs API")).toBeInTheDocument()
    expect(screen.getByText("Review Docs")).toBeInTheDocument()

    expect(screen.queryByText("Manage Plugin")).not.toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Tools Preview" })).not.toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Included Capabilities" })).not.toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "MCP Bindings" })).not.toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Install Review" })).not.toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Connectors" })).not.toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Plugin Values" })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Docs API key/)).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Update key" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Diagnose" })).not.toBeInTheDocument()
    expect(screen.queryByText("Connector reachable. Tools: search_docs")).not.toBeInTheDocument()
  })

  it("uninstalls an installed plugin from the selected plugin details", () => {
    const onDeleteInstalledPlugin = vi.fn()
    render(
      <PluginsPage
        {...createProps({
          activePluginID: "filesystem",
          installedPlugins: [createInstalledPlugin()],
          onDeleteInstalledPlugin,
        })}
      />,
    )

    const uninstallButton = screen.getByRole("button", { name: "Uninstall Filesystem" })
    expect(uninstallButton.closest(".plugins-detail-actions")).not.toBeNull()

    fireEvent.click(uninstallButton)
    expect(onDeleteInstalledPlugin).toHaveBeenCalledWith("filesystem")
  })

  it("shows progress while uninstalling an installed plugin", () => {
    render(
      <PluginsPage
        {...createProps({
          activePluginID: "filesystem",
          deletingPluginID: "filesystem",
          installedPlugins: [createInstalledPlugin()],
        })}
      />,
    )

    const uninstallButton = screen.getByRole("button", { name: "Uninstall Filesystem" })
    expect(uninstallButton).toBeDisabled()
    expect(uninstallButton).toHaveTextContent("Uninstalling...")
  })

  it("expands included content rows and switches the visible detail", () => {
    const plugin = createDocsPlugin()

    render(
      <PluginsPage
        {...createProps({
          activePluginID: "docs",
          pluginCatalog: [plugin],
          installedPlugins: [
            createInstalledPlugin({
              pluginID: "docs",
              mcpServerID: "plugin.docs.app.docs-api",
              mcpServerIDs: ["plugin.docs.app.docs-api"],
              skillIDs: ["plugin:docs:review"],
              connectorIDs: ["plugin-app:docs:docs-api"],
              config: {},
            }),
          ],
          pluginConnectorStatuses: {
            docs: [
              {
                pluginID: "docs",
                appID: "docs-api",
                connectorID: "plugin-app:docs:docs-api",
                connected: true,
                credentialKind: "api_key",
                authStatus: "connected",
                credentialLabel: "Docs API key",
                generatedMcpServerID: "plugin.docs.app.docs-api",
              },
            ],
          },
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Show details for Review Docs" }))
    expect(screen.getByText("Skill ID")).toBeInTheDocument()
    expect(screen.getByText("plugin:docs:review")).toBeInTheDocument()
    expect(screen.getByText("Directory")).toBeInTheDocument()
    expect(screen.getByText("review")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Show details for Docs API" }))
    expect(screen.queryByText("plugin:docs:review")).not.toBeInTheDocument()
    expect(screen.getByText("Connector ID")).toBeInTheDocument()
    expect(screen.getByText("plugin-app:docs:docs-api")).toBeInTheDocument()
    expect(screen.getByText("Credential")).toBeInTheDocument()
    expect(screen.getAllByText("Docs API key").length).toBeGreaterThan(0)
    expect(screen.getByText("https://docs.example.test/mcp")).toBeInTheDocument()
  })

  it("uses the Codicons MCP glyph for included MCP servers", () => {
    render(
      <PluginsPage
        {...createProps({
          activePluginID: "filesystem",
        })}
      />,
    )

    const mcpRow = screen.getByRole("button", { name: "Show details for Filesystem" })
    expect(mcpRow.querySelector(".plugins-included-icon .codicon-mcp")).not.toBeNull()
    expect(mcpRow.querySelector(".plugins-included-icon .lucide-puzzle")).toBeNull()
  })

  it("uses the Sparkles glyph for included Skills", () => {
    render(
      <PluginsPage
        {...createProps({
          activePluginID: "docs",
          pluginCatalog: [createDocsPlugin()],
        })}
      />,
    )

    const skillRow = screen.getByRole("button", { name: "Show details for Review Docs" })
    expect(skillRow.querySelector(".plugins-included-icon .lucide-sparkles")).not.toBeNull()
    expect(skillRow.querySelector(".plugins-included-icon .lucide-settings")).toBeNull()
  })

  it("browses an installed plugin Skill folder from the Skill row context menu", async () => {
    const plugin = createDocsPlugin()
    const listInstalledPluginSkillEntries = vi.fn(async (input: {
      pluginID: string
      skillID: string
      path?: string
    }) => {
      if (input.path === "references") {
        return {
          pluginID: "docs",
          skillID: "plugin:docs:review",
          skillName: "Review Docs",
          path: "references",
          entries: [
            {
              kind: "file" as const,
              name: "checklist.md",
              path: "references/checklist.md",
              size: 28,
              mimeType: "text/markdown",
            },
          ],
          readOnly: true as const,
        }
      }

      return {
        pluginID: "docs",
        skillID: "plugin:docs:review",
        skillName: "Review Docs",
        path: "",
        entries: [
          {
            kind: "directory" as const,
            name: "references",
            path: "references",
            hasChildren: true,
          },
          {
            kind: "file" as const,
            name: "SKILL.md",
            path: "SKILL.md",
            size: 92,
            mimeType: "text/markdown",
          },
        ],
        readOnly: true as const,
      }
    })
    const readInstalledPluginSkillFile = vi.fn(async (input: {
      pluginID: string
      skillID: string
      path: string
    }) => {
      const isChecklist = input.path === "references/checklist.md"
      const content = isChecklist
        ? "# Checklist\n\nCheck links and examples."
        : "---\nname: review-docs\ndescription: Review documentation output.\n---\n# Review Docs\n\nStart here."

      return {
        pluginID: "docs",
        skillID: "plugin:docs:review",
        skillName: "Review Docs",
        path: input.path,
        name: isChecklist ? "checklist.md" : "SKILL.md",
        kind: "text" as const,
        mimeType: "text/markdown",
        size: content.length,
        content,
        tooLarge: false,
        readOnly: true as const,
      }
    })
    window.desktop = {
      listInstalledPluginSkillEntries,
      readInstalledPluginSkillFile,
    } as unknown as Window["desktop"]

    render(
      <PluginsPage
        {...createProps({
          activePluginID: "docs",
          pluginCatalog: [plugin],
          installedPlugins: [
            createInstalledPlugin({
              pluginID: "docs",
              enabled: false,
              mcpServerID: "plugin.docs.app.docs-api",
              mcpServerIDs: ["plugin.docs.app.docs-api"],
              skillIDs: ["plugin:docs:review"],
              connectorIDs: ["plugin-app:docs:docs-api"],
              config: {},
            }),
          ],
        })}
      />,
    )

    const skillRow = screen.getByRole("button", { name: "Show details for Review Docs" })
    fireEvent.contextMenu(skillRow, {
      clientX: 120,
      clientY: 180,
    })

    const menu = screen.getByRole("menu", { name: "Review Docs actions" })
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Browse Skill files" }))

    const dialog = await screen.findByRole("dialog", { name: "Browse files for Review Docs" })
    await waitFor(() => {
      expect(listInstalledPluginSkillEntries).toHaveBeenCalledWith({
        pluginID: "docs",
        skillID: "plugin:docs:review",
        path: "",
      })
      expect(readInstalledPluginSkillFile).toHaveBeenCalledWith({
        pluginID: "docs",
        skillID: "plugin:docs:review",
        path: "SKILL.md",
      })
    })
    expect(within(dialog).getByRole("heading", { level: 1, name: "Review Docs" })).toBeInTheDocument()
    expect(within(dialog).getByText("Start here.")).toBeInTheDocument()
    expect(within(dialog).queryByText("name: review-docs")).not.toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole("treeitem", { name: "references" }))
    const checklist = await within(dialog).findByRole("treeitem", { name: "checklist.md" })
    expect(listInstalledPluginSkillEntries).toHaveBeenCalledWith({
      pluginID: "docs",
      skillID: "plugin:docs:review",
      path: "references",
    })

    fireEvent.click(checklist)
    await waitFor(() => {
      expect(readInstalledPluginSkillFile).toHaveBeenCalledWith({
        pluginID: "docs",
        skillID: "plugin:docs:review",
        path: "references/checklist.md",
      })
    })
    expect(within(dialog).getByRole("heading", { name: "Checklist" })).toBeInTheDocument()
    expect(within(dialog).getByText("Check links and examples.")).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole("treeitem", { name: "SKILL.md" }))
    await waitFor(() => {
      expect(within(dialog).getByText("Start here.")).toBeInTheDocument()
    })
    const renderedTab = within(dialog).getByRole("tab", { name: "Rendered" })
    renderedTab.focus()
    fireEvent.keyDown(renderedTab, { key: "ArrowRight" })
    expect(within(dialog).getByRole("tab", { name: "Source" })).toHaveAttribute("aria-selected", "true")
    expect(within(dialog).getByText(/name: review-docs/)).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole("button", { name: "Close Skill browser" }))
    expect(screen.queryByRole("dialog", { name: "Browse files for Review Docs" })).not.toBeInTheDocument()
  })

  it("disables Skill folder browsing until the plugin package is available", () => {
    const plugin = createDocsPlugin()
    const { rerender } = render(
      <PluginsPage
        {...createProps({
          activePluginID: "docs",
          pluginCatalog: [plugin],
        })}
      />,
    )

    const skillRow = screen.getByRole("button", { name: "Show details for Review Docs" })
    fireEvent.contextMenu(skillRow, {
      clientX: 120,
      clientY: 180,
    })

    const unavailableMenuItem = screen.getByRole("menuitem", { name: "Browse Skill files" })
    expect(unavailableMenuItem).toBeDisabled()
    expect(unavailableMenuItem).toHaveAttribute(
      "title",
      "Install this plugin before browsing its Skill files.",
    )
    fireEvent.keyDown(document, { key: "Escape" })

    rerender(
      <PluginsPage
        {...createProps({
          activePluginID: "docs",
          pluginCatalog: [plugin],
          installedPlugins: [
            createInstalledPlugin({
              pluginID: "docs",
              missingPackage: true,
              skillIDs: ["plugin:docs:review"],
            }),
          ],
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Show details for Review Docs" }))
    expect(screen.getByRole("button", { name: "Browse Skill files" })).toBeDisabled()
    expect(screen.queryByRole("dialog", { name: "Browse files for Review Docs" })).not.toBeInTheDocument()
  })

  it("manages a plugin-owned MCP binding from the plugin detail", () => {
    const onDiagnoseMcpServer = vi.fn()
    const onSetInstalledPluginMcpEnabled = vi.fn()
    const onSetInstalledPluginMcpToolPolicy = vi.fn()

    render(
      <PluginsPage
        {...createProps({
          activePluginID: "filesystem",
          installedPlugins: [
            createInstalledPlugin({
              mcpServerEnabled: {
                "plugin.filesystem": true,
              },
            }),
          ],
          mcpServers: [
            {
              id: "plugin.filesystem",
              name: "Filesystem",
              owner: {
                kind: "plugin",
                pluginID: "filesystem",
                bindingID: "mcp:default",
              },
              transport: "stdio",
              command: "npx",
              args: ["server-filesystem"],
              enabled: true,
            },
          ],
          mcpDiagnostics: {
            "plugin.filesystem": {
              serverID: "plugin.filesystem",
              enabled: true,
              ok: true,
              toolCount: 1,
              toolNames: ["read_file"],
              tools: [
                {
                  name: "read_file",
                  displayName: "Read file",
                  description: "Read a file.",
                  annotations: {
                    readOnlyHint: true,
                  },
                  riskHint: "read-only",
                  recommendedPolicy: "auto",
                },
              ],
            },
          },
          onDiagnoseMcpServer,
          onSetInstalledPluginMcpEnabled,
          onSetInstalledPluginMcpToolPolicy,
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Show details for Filesystem" }))

    const mcpSwitch = screen.getByRole("switch", { name: "Enable MCP server Filesystem" })
    expect(mcpSwitch).toHaveAttribute("aria-checked", "true")
    fireEvent.click(mcpSwitch)
    expect(onSetInstalledPluginMcpEnabled).toHaveBeenCalledWith(
      "filesystem",
      "plugin.filesystem",
      false,
    )

    fireEvent.click(screen.getByRole("button", { name: "Diagnose" }))
    expect(onDiagnoseMcpServer).toHaveBeenCalledWith("plugin.filesystem")

    expect(screen.getByText("Tool Permissions")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("combobox", { name: "Policy for read_file" }))
    fireEvent.click(screen.getByRole("option", { name: "Disabled" }))
    expect(onSetInstalledPluginMcpToolPolicy).toHaveBeenCalledWith(
      "filesystem",
      "plugin.filesystem",
      "read_file",
      "disabled",
    )
  })

  it("handles MCP preview, missing binding, diagnostic failure, and saving states", () => {
    const baseProps = createProps({
      activePluginID: "filesystem",
    })
    const { rerender } = render(<PluginsPage {...baseProps} />)

    fireEvent.click(screen.getByRole("button", { name: "Show details for Filesystem" }))
    expect(
      screen.getByText("Install this plugin to register and manage this MCP server."),
    ).toBeInTheDocument()

    rerender(
      <PluginsPage
        {...createProps({
          activePluginID: "filesystem",
          installedPlugins: [createInstalledPlugin()],
        })}
      />,
    )
    expect(
      screen.getByRole("alert"),
    ).toHaveTextContent("The installed plugin is missing this MCP binding.")
    expect(screen.getByRole("button", { name: "Repair plugin" })).toBeEnabled()

    rerender(
      <PluginsPage
        {...createProps({
          activePluginID: "filesystem",
          installedPlugins: [createInstalledPlugin()],
          mcpServers: [
            {
              id: "plugin.filesystem",
              name: "Filesystem",
              owner: {
                kind: "plugin",
                pluginID: "filesystem",
                bindingID: "mcp:default",
              },
              transport: "stdio",
              command: "npx",
              enabled: true,
            },
          ],
          mcpDiagnostics: {
            "plugin.filesystem": createDiagnostic({
              ok: false,
              error: "Runtime unavailable.",
            }),
          },
          diagnosingMcpServerID: "plugin.filesystem",
          savingMcpServerID: "plugin.filesystem",
        })}
      />,
    )

    expect(screen.getByRole("switch", { name: "Enable MCP server Filesystem" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Checking..." })).toBeDisabled()
    expect(screen.getByRole("alert")).toHaveTextContent("Runtime unavailable.")
  })

  it("keeps child MCP preferences while the plugin master switch is off", () => {
    const onSetInstalledPluginEnabled = vi.fn()

    render(
      <PluginsPage
        {...createProps({
          activePluginID: "filesystem",
          installedPlugins: [
            createInstalledPlugin({
              enabled: false,
              mcpServerEnabled: {
                "plugin.filesystem": true,
              },
            }),
          ],
          mcpServers: [
            {
              id: "plugin.filesystem",
              name: "Filesystem",
              owner: {
                kind: "plugin",
                pluginID: "filesystem",
                bindingID: "mcp:default",
              },
              transport: "stdio",
              command: "npx",
              enabled: false,
            },
          ],
          onSetInstalledPluginEnabled,
        })}
      />,
    )

    const masterSwitch = screen.getByRole("switch", { name: "Enable plugin Filesystem" })
    expect(masterSwitch).toHaveAttribute("aria-checked", "false")
    fireEvent.click(masterSwitch)
    expect(onSetInstalledPluginEnabled).toHaveBeenCalledWith("filesystem", true)

    fireEvent.click(screen.getByRole("button", { name: "Show details for Filesystem" }))
    const childSwitch = screen.getByRole("switch", { name: "Enable MCP server Filesystem" })
    expect(childSwitch).toHaveAttribute("aria-checked", "true")
    expect(childSwitch).toBeDisabled()
  })

  it("shows platform connector requirement connection state from global connectors", () => {
    const plugin = createPlugin({
      id: "mail-helper",
      name: "Mail Helper",
      mcpServers: [],
      skills: [],
      apps: [],
      configFields: [],
      connectorRequirements: [
        {
          connector: "gmail",
          reason: "Search and summarize mailbox context.",
          tools: ["search_email_ids"],
          permissions: ["Read Gmail metadata"],
        },
      ],
    })
    const onManageConnector = vi.fn()

    render(
      <PluginsPage
        {...createProps({
          activePluginID: "mail-helper",
          pluginCatalog: [plugin],
          installedPlugins: [
            createInstalledPlugin({
              pluginID: "mail-helper",
              mcpServerID: "plugin.mail-helper",
              mcpServerIDs: [],
              connectorRequirementIDs: ["connector:gmail:default"],
              config: {},
            }),
          ],
          connectorStatuses: [
            {
              connectorID: "connector:gmail:default",
              definitionID: "gmail",
              name: "Gmail",
              connected: true,
              available: true,
              authStatus: "connected",
              credentialKind: "oauth",
              credentialLabel: "Google account",
              email: "person@example.test",
              generatedMcpServerID: "connector.gmail.default",
            },
          ],
          onManageConnector,
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Show details for gmail" }))
    expect(screen.getByText("Platform connector")).toBeInTheDocument()
    expect(screen.getByText("Connected")).toBeInTheDocument()
    expect(screen.getByText("connector:gmail:default")).toBeInTheDocument()
    expect(screen.getByText("person@example.test")).toBeInTheDocument()
    expect(screen.getByText("connector.gmail.default")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Manage in Connectors" }))
    expect(onManageConnector).toHaveBeenCalledWith("connector:gmail:default")
  })

  it("shows an Anybox built-in MCP requirement as enabled and manages it from MCP", () => {
    const plugin = createPlugin({
      id: "chrome",
      name: "Chrome",
      mcpServers: [],
      skills: [],
      apps: [],
      configFields: [],
      mcpRequirements: [
        {
          mcp: "node-repl",
          reason: "Run the plugin Browser Client in the persistent Node runtime.",
        },
      ],
    })
    const onManageConnector = vi.fn()
    const onManageMcpServer = vi.fn()

    render(
      <PluginsPage
        {...createProps({
          activePluginID: "chrome",
          pluginCatalog: [plugin],
          mcpServers: [
            {
              id: "anybox.node-repl",
              name: "Node REPL",
              owner: {
                kind: "anybox",
                bindingID: "node-repl",
              },
              transport: "stdio",
              command: "node",
              args: ["mcp/node-repl/server.js"],
              enabled: true,
            },
          ],
          onManageConnector,
          onManageMcpServer,
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Show details for node-repl" }))
    expect(screen.getByText("Anybox built-in MCP")).toBeInTheDocument()
    expect(screen.getByText("Enabled")).toBeInTheDocument()
    expect(screen.getByText("anybox.node-repl")).toBeInTheDocument()
    expect(screen.queryByText("Platform connector")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Manage in Connectors" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Manage in MCP" }))
    expect(onManageMcpServer).toHaveBeenCalledWith("anybox.node-repl")
    expect(onManageConnector).not.toHaveBeenCalled()
  })

  it("shows OAuth connector sign-in controls in included app details", () => {
    const plugin = createOAuthPlugin()
    const onStartInstalledPluginConnectorAuthFlow = vi.fn()
    const onDeleteInstalledPluginConnectorAuthSession = vi.fn()
    const onSetInstalledPluginMcpEnabled = vi.fn()

    render(
      <PluginsPage
        {...createProps({
          activePluginID: "mail",
          pluginCatalog: [plugin],
          installedPlugins: [
            createInstalledPlugin({
              pluginID: "mail",
              mcpServerID: "plugin.mail.app.gmail",
              mcpServerIDs: ["plugin.mail.app.gmail"],
              mcpServerEnabled: {
                "plugin.mail.app.gmail": true,
              },
              connectorIDs: ["plugin-app:mail:gmail"],
              config: {},
            }),
          ],
          mcpServers: [
            {
              id: "plugin.mail.app.gmail",
              name: "Gmail",
              owner: {
                kind: "plugin",
                pluginID: "mail",
                bindingID: "app:gmail",
              },
              transport: "remote",
              serverUrl: "https://gmail.example.test/mcp",
              enabled: true,
            },
          ],
          pluginConnectorStatuses: {
            mail: [
              {
                pluginID: "mail",
                appID: "gmail",
                connectorID: "plugin-app:mail:gmail",
                connected: false,
                credentialKind: "oauth",
                authStatus: "not_connected",
                credentialLabel: "Google account",
                generatedMcpServerID: "plugin.mail.app.gmail",
              },
            ],
          },
          onStartInstalledPluginConnectorAuthFlow,
          onDeleteInstalledPluginConnectorAuthSession,
          onSetInstalledPluginMcpEnabled,
        })}
      />,
    )

    expect(screen.getByText("Credential kind")).toBeInTheDocument()
    expect(screen.getByText("OAuth")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("switch", { name: "Enable MCP server Gmail" }))
    expect(onSetInstalledPluginMcpEnabled).toHaveBeenCalledWith(
      "mail",
      "plugin.mail.app.gmail",
      false,
    )
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }))
    expect(onStartInstalledPluginConnectorAuthFlow).toHaveBeenCalledWith("mail", "gmail")
    expect(screen.queryByRole("textbox", { name: /Google account/ })).not.toBeInTheDocument()
  })
})
