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
    skillIDs: overrides.skillIDs ?? [],
    connectorIDs: overrides.connectorIDs ?? [],
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
    savingPluginConnectorID: null,
    updatingPluginID: null,
    onCancelInstalledPluginConnectorAuthFlow: vi.fn(),
    onDeleteInstalledPlugin: vi.fn(),
    onDeleteInstalledPluginConnectorApiKey: vi.fn(),
    onDeleteInstalledPluginConnectorAuthSession: vi.fn(),
    onDiagnoseInstalledPlugin: vi.fn(),
    onDiagnoseInstalledPluginConnector: vi.fn(),
    onImportPluginFromURL: vi.fn(),
    onInstallPlugin: vi.fn(),
    onPluginDraftAppApiKeyChange: vi.fn(),
    onPluginDraftConfigChange: vi.fn(),
    onPluginDeselect: vi.fn(),
    onPluginSelect: vi.fn(),
    onSaveInstalledPluginConnectorApiKey: vi.fn(),
    onSaveInstalledPluginConfig: vi.fn(),
    onSetInstalledPluginEnabled: vi.fn(),
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
    expect(onInstallPlugin).toHaveBeenCalledWith("filesystem")
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

  it("renders primary category navigation and featured plugin list", () => {
    render(
      <PluginsPage
        {...createProps({
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
          ],
        })}
      />,
    )

    const categoryNav = screen.getByRole("navigation", { name: "Plugin categories" })
    expect(within(categoryNav).getByRole("button", { name: "All, 3 plugins" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.queryByRole("region", { name: "Plugin promotion" })).not.toBeInTheDocument()
    expect(screen.getByRole("region", { name: "Featured plugins" })).toBeInTheDocument()
    expect(screen.getByRole("list", { name: "Featured" })).toBeInTheDocument()

    fireEvent.click(within(categoryNav).getByRole("button", { name: "Docs, 1 plugin" }))

    expect(within(categoryNav).getByRole("button", { name: "Docs, 1 plugin" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "Docs not installed" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Filesystem not installed" })).not.toBeInTheDocument()

    fireEvent.click(within(categoryNav).getByRole("button", { name: "All, 3 plugins" }))

    expect(within(categoryNav).getByRole("button", { name: "All, 3 plugins" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "Filesystem not installed" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Docs not installed" })).toBeInTheDocument()
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
    const installedButton = within(installedSidebar).getByRole("button", { name: "Filesystem installed enabled" })
    fireEvent.click(installedButton)

    expect(onPluginSelect).toHaveBeenCalledWith("filesystem")
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
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Show details for gmail" }))
    expect(screen.getByText("Platform connector")).toBeInTheDocument()
    expect(screen.getByText("Connected")).toBeInTheDocument()
    expect(screen.getByText("connector:gmail:default")).toBeInTheDocument()
    expect(screen.getByText("person@example.test")).toBeInTheDocument()
    expect(screen.getByText("connector.gmail.default")).toBeInTheDocument()
  })

  it("shows OAuth connector sign-in controls in included app details", () => {
    const plugin = createOAuthPlugin()
    const onStartInstalledPluginConnectorAuthFlow = vi.fn()
    const onDeleteInstalledPluginConnectorAuthSession = vi.fn()

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
              connectorIDs: ["plugin-app:mail:gmail"],
              config: {},
            }),
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
        })}
      />,
    )

    expect(screen.getByText("Credential kind")).toBeInTheDocument()
    expect(screen.getByText("OAuth")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }))
    expect(onStartInstalledPluginConnectorAuthFlow).toHaveBeenCalledWith("mail", "gmail")
    expect(screen.queryByRole("textbox", { name: /Google account/ })).not.toBeInTheDocument()
  })
})
