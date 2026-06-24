import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import type { ComponentProps } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { APPEARANCE_TOKEN_NAMES } from "../../../../shared/appearance"
import type { DesktopAppUpdateState } from "../../../../shared/desktop-ipc-contract"
import { I18nProvider } from "../i18n/I18nProvider"
import { DEFAULT_HTML_BACKGROUND_CONFIG } from "../html-background/html-background-config"
import { DEFAULT_ASSISTANT_TRACE_VISIBILITY, type McpServerDraftState } from "../types"
import { SettingsPage } from "./SettingsPage"

function setDesktopMock(value: unknown) {
  Object.defineProperty(window, "desktop", {
    configurable: true,
    writable: true,
    value,
  })
}

function createMcpDraft(): McpServerDraftState {
  return {
    id: "",
    name: "",
    transport: "stdio",
    command: "",
    args: "",
    env: "",
    cwd: "",
    serverUrl: "",
    connectorId: "",
    authorization: "",
    headers: "",
    allowedToolsMode: "all",
    allowedToolNames: "",
    toolPolicies: {},
    enabled: true,
    timeoutMs: "",
  }
}

function createAppUpdateState(overrides: Partial<DesktopAppUpdateState> = {}): DesktopAppUpdateState {
  const baseState: DesktopAppUpdateState = {
    phase: "idle",
    version: "1.2.3",
    automaticUpdates: true,
    updateChecksSupported: true,
    latestVersion: null,
    downloadPercent: null,
    downloadTransferredBytes: null,
    downloadTotalBytes: null,
    downloadBytesPerSecond: null,
    error: null,
    lastCheckedAt: null,
    releaseNotes: null,
  }
  return { ...baseState, ...overrides }
}

function createAppearanceTokenValues(
  value = "#000000",
): ComponentProps<typeof SettingsPage>["appearanceTokenValues"] {
  return Object.fromEntries(APPEARANCE_TOKEN_NAMES.map((tokenName) => [tokenName, value])) as ComponentProps<
    typeof SettingsPage
  >["appearanceTokenValues"]
}

function selectSettingsOption(label: string, option: string) {
  fireEvent.click(screen.getByRole("combobox", { name: label }))
  fireEvent.click(within(screen.getByRole("listbox", { name: label })).getByRole("option", { name: option }))
}

function createSettingsPageProps(
  overrides: Partial<ComponentProps<typeof SettingsPage>> = {},
): ComponentProps<typeof SettingsPage> {
  return {
    activeMcpServerDiagnostic: null,
    activeMcpServerID: null,
    appearanceConfigError: null,
    appearanceConfigPath: null,
    appearanceConfigPreview: "{}",
    appearanceOverrides: {},
    appearanceTokenValues: createAppearanceTokenValues(),
    archivedSessions: [],
    archivedSessionsError: null,
    assistantTraceVisibility: DEFAULT_ASSISTANT_TRACE_VISIBILITY,
    brandTheme: "sage",
    catalog: [],
    codeThemePreference: "auto",
    colorMode: "system",
    fontFamily: "default",
    htmlBackgroundConfig: DEFAULT_HTML_BACKGROUND_CONFIG,
    deletingArchivedSessionID: null,
    deletingMcpServerID: null,
    deletingProviderID: null,
    isActivityRailVisible: true,
    isAgentDebugTraceEnabled: false,
    isDebugLineColorsEnabled: false,
    isDebugUiRegionsEnabled: false,
    isDeletingAllArchivedSessions: false,
    isLoading: false,
    isLoadingArchivedSessions: false,
    isOpen: true,
    appUpdateState: createAppUpdateState(),
    appUpdateStatus: null,
    isCheckingAppUpdate: false,
    isSavingAutomaticUpdates: false,
    isRefreshingProviderCatalog: false,
    loadError: null,
    mcpServerDraft: createMcpDraft(),
    mcpServers: [],
    models: [],
    customProviderDraft: {
      apiBaseURL: "",
      apiKey: "",
      defaultModel: "",
      chatEndpoint: "/chat/completions",
    },
    onActivityRailVisibilityChange: vi.fn(),
    onAgentDebugTraceChange: vi.fn(),
    onAppearancePaletteReset: vi.fn(),
    onAppearanceTokenChange: vi.fn(),
    onAppearanceTokenReset: vi.fn(),
    onAutomaticUpdatesToggle: vi.fn(),
    onAssistantTraceVisibilityChange: vi.fn(),
    onBrandThemeChange: vi.fn(),
    onCancelProviderAuthFlow: vi.fn(),
    onCodeThemeChange: vi.fn(),
    onCustomProviderDraftChange: vi.fn(),
    onCustomProviderDraftReset: vi.fn(),
    onCheckForUpdates: vi.fn(),
    onClose: vi.fn(),
    onColorModeChange: vi.fn(),
    onFontFamilyChange: vi.fn(),
    onHtmlBackgroundConfigChange: vi.fn(),
    onDebugLineColorsChange: vi.fn(),
    onDebugUiRegionsChange: vi.fn(),
    onDeleteAllArchivedSessions: vi.fn(),
    onDeleteArchivedSession: vi.fn(),
    onDeleteMcpServer: vi.fn(),
    onDeleteProvider: vi.fn(),
    onDeleteProviderAuthSession: vi.fn(),
    onMcpServerDraftChange: vi.fn(),
    onMcpToolPolicyChange: vi.fn(),
    onMcpServerSelect: vi.fn(),
    onLoadArchivedSessions: vi.fn(),
    onOpenUpdateCenter: vi.fn(),
    onRefreshProviderCatalog: vi.fn(),
    onRestoreArchivedSession: vi.fn(),
    onSaveMcpServer: vi.fn(),
    onSaveCustomProvider: vi.fn(),
    onSaveProvider: vi.fn(),
    onSaveProviderApiKey: vi.fn(),
    onSelectionChange: vi.fn(),
    onStartNewMcpServer: vi.fn(),
    onStartProviderAuthFlow: vi.fn(),
    onTestCustomProviderConnection: vi.fn(),
    onTestProviderConnection: vi.fn(),
    providerDrafts: {},
    restoringArchivedSessionID: null,
    savingMcpServerID: null,
    savingProviderID: null,
    selectionDraft: {
      model: null,
      smallModel: null,
      reasoningEffort: null,
      imageModel: null,
      imageDefaultSize: null,
      imageDefaultCount: null,
    },
    ...overrides,
  } as ComponentProps<typeof SettingsPage>
}

function createProvider(id: string, name: string): ComponentProps<typeof SettingsPage>["catalog"][number] {
  return {
    id,
    name,
    source: "config",
    env: [],
    configured: true,
    available: true,
    apiKeyConfigured: true,
    modelCount: 1,
    authCapabilities: [],
    authScope: "global",
    authState: {
      providerID: id,
      scope: "global",
      status: "connected",
      capabilities: [],
      credentials: [],
    },
  }
}

type SettingsProvider = ComponentProps<typeof SettingsPage>["catalog"][number]

type SettingsProviderOverrides = Omit<Partial<SettingsProvider>, "authCapabilities" | "authState"> & {
  authCapabilities?: SettingsProvider["authCapabilities"]
  authState?: Partial<SettingsProvider["authState"]>
}

function createAnyboxProvider(overrides: SettingsProviderOverrides = {}): SettingsProvider {
  const authCapabilities = overrides.authCapabilities ?? [
    {
      method: "anybox-browser",
      label: "Anybox",
      kind: "browser_oauth" as const,
      recommended: true,
      supportsDisconnect: true,
      supportsPolling: true,
    },
  ]
  const base = createProvider("anybox", "Anybox")

  return {
    ...base,
    ...overrides,
    apiKeyConfigured: false,
    authCapabilities,
    authState: {
      ...base.authState,
      activeMethod: "anybox-browser",
      capabilities: authCapabilities,
      credentials: [],
      status: "not_connected",
      ...overrides.authState,
    },
  }
}

function createModel(
  providerID: string,
  id: string,
  name: string,
  input?: {
    family?: string
    imageOutput?: boolean
    reasoning?: boolean
  },
): ComponentProps<typeof SettingsPage>["models"][number] {
  return {
    id,
    providerID,
    name,
    family: input?.family,
    status: "active",
    available: true,
    capabilities: {
      temperature: true,
      reasoning: input?.reasoning ?? false,
      attachment: false,
      toolcall: true,
      input: {
        text: true,
        audio: false,
        image: false,
        video: false,
        pdf: false,
      },
      output: {
        text: true,
        audio: false,
        image: input?.imageOutput ?? false,
        video: false,
        pdf: false,
      },
    },
    limit: {
      context: 128000,
      output: 8192,
    },
  }
}

function createArchivedSession(
  overrides: Partial<ComponentProps<typeof SettingsPage>["archivedSessions"][number]> = {},
): ComponentProps<typeof SettingsPage>["archivedSessions"][number] {
  return {
    id: "session-archived-1",
    projectID: "project-1",
    projectName: "Project One",
    projectMissing: false,
    directory: "C:\\Projects\\project-one",
    title: "Project analysis",
    created: 1,
    updated: 2,
    archivedAt: 3,
    messageCount: 4,
    eventCount: 5,
    ...overrides,
  }
}

describe("SettingsPage built-in tools", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
    delete (window as typeof window & { desktop?: unknown }).desktop
  })

  it("renders about update controls and saves the automatic update setting", async () => {
    const onAutomaticUpdatesToggle = vi.fn()
    const onCheckForUpdates = vi.fn()

    render(<SettingsPage {...createSettingsPageProps({ onAutomaticUpdatesToggle, onCheckForUpdates })} />)

    expect(screen.getByText("Version 1.2.3")).toBeInTheDocument()
    expect(screen.queryByText("Installer version: 1.2.3")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Read release notes" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Check for updates" })).toBeInTheDocument()

    const automaticUpdatesSwitch = screen.getByRole("switch", { name: /Automatic updates/i })
    expect(automaticUpdatesSwitch).toHaveAttribute("aria-checked", "true")

    fireEvent.click(automaticUpdatesSwitch)
    expect(onAutomaticUpdatesToggle).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }))
    expect(onCheckForUpdates).toHaveBeenCalledTimes(1)
  })

  it("does not expose a duplicate dedicated updates settings section", () => {
    render(<SettingsPage {...createSettingsPageProps()} />)

    expect(screen.queryByRole("button", { name: "Updates" })).not.toBeInTheDocument()
    expect(screen.getByText("Version 1.2.3")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Check for updates" })).toBeInTheDocument()
    expect(screen.getByRole("switch", { name: /Automatic updates/i })).toBeInTheDocument()
  })

  it("routes downloaded update entry points to the global update center", () => {
    const onOpenUpdateCenter = vi.fn()

    render(
      <SettingsPage
        {...createSettingsPageProps({
          appUpdateState: createAppUpdateState({
            phase: "downloaded",
            latestVersion: "1.2.4",
            downloadPercent: 100,
            lastCheckedAt: 1,
            releaseNotes: "Improved update experience.",
          }),
          onOpenUpdateCenter,
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: /Open update center/i }))
    expect(onOpenUpdateCenter).toHaveBeenCalledTimes(1)
  })

  it("scrolls the active settings section back to the top when its nav item is clicked again", () => {
    const { container } = render(<SettingsPage {...createSettingsPageProps()} />)
    const overlay = container.querySelector(".settings-page-overlay") as HTMLElement | null
    const mainPanel = container.querySelector(".settings-page-main") as HTMLDivElement | null
    expect(overlay).not.toBeNull()
    expect(mainPanel).not.toBeNull()

    overlay!.scrollTop = 80
    mainPanel!.scrollTop = 120
    fireEvent.click(screen.getByRole("button", { name: "General" }))

    expect(overlay!.scrollTop).toBe(0)
    expect(mainPanel!.scrollTop).toBe(0)
  })

  it("does not render a settings-local toast region", () => {
    const { container } = render(<SettingsPage {...createSettingsPageProps()} />)

    expect(container.querySelector(".settings-toast-region")).toBeNull()
    expect(screen.queryByRole("button", { name: "Dismiss settings message" })).not.toBeInTheDocument()
  })

  it("does not render built-in tools inside settings", () => {
    render(<SettingsPage {...createSettingsPageProps()} />)

    expect(screen.queryByRole("button", { name: "Tools" })).not.toBeInTheDocument()
    expect(screen.queryByText("Global tool availability")).not.toBeInTheDocument()
  })

  it("does not render worktrees inside settings", () => {
    render(<SettingsPage {...createSettingsPageProps()} />)

    expect(screen.queryByRole("button", { name: "Worktrees" })).not.toBeInTheDocument()
    expect(screen.queryByText("Tracked Worktrees")).not.toBeInTheDocument()
    expect(screen.queryByRole("list", { name: "Project worktrees" })).not.toBeInTheDocument()
  })

  it("shows Account after General and before Provider in settings navigation", () => {
    render(<SettingsPage {...createSettingsPageProps({ catalog: [createAnyboxProvider()] })} />)

    const nav = screen.getByLabelText("Settings sections")
    const labels = within(nav).getAllByRole("button").map((button) => button.textContent)

    expect(labels.slice(0, 3)).toEqual(["General", "Account", "Provider"])
  })

  it("uses the Anybox account page as the browser OAuth login entry", () => {
    const onStartProviderAuthFlow = vi.fn()
    const { container } = render(
      <SettingsPage
        {...createSettingsPageProps({
          catalog: [createAnyboxProvider()],
          onStartProviderAuthFlow,
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Account" }))

    expect(screen.getByText("Not logged in")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Log in to Anybox" })).toBeInTheDocument()
    expect(container.querySelector('input[type="password"]')).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Log in to Anybox" }))
    expect(onStartProviderAuthFlow).toHaveBeenCalledWith("anybox", { prompt: "select_account" })
  })

  it("shows a cancellable pending Anybox account flow", () => {
    const onCancelProviderAuthFlow = vi.fn()
    render(
      <SettingsPage
        {...createSettingsPageProps({
          catalog: [
            createAnyboxProvider({
              authState: {
                status: "pending",
                flow: {
                  id: "flow-1",
                  providerID: "anybox",
                  method: "anybox-browser",
                  kind: "browser_oauth",
                  status: "waiting_user",
                  startedAt: 1,
                  updatedAt: 2,
                  authorizationURL: "https://provider.example/oauth",
                },
              },
            }),
          ],
          onCancelProviderAuthFlow,
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Account" }))

    expect(screen.getByText("Waiting for browser login")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    expect(onCancelProviderAuthFlow).toHaveBeenCalledWith("anybox")
  })

  it("shows connected Anybox account details and signs out from the account page", () => {
    const onDeleteProviderAuthSession = vi.fn()
    const openExternalUrl = vi.fn().mockResolvedValue({ ok: true, url: "https://provider.example/billing" })
    setDesktopMock({ openExternalUrl })

    render(
      <SettingsPage
        {...createSettingsPageProps({
          catalog: [
            createAnyboxProvider({
              authState: {
                status: "connected",
                account: {
                  email: "agent@example.com",
                  workspaceName: "Studio",
                  planType: "pro",
                  planLabel: "Pro",
                  subscription: {
                    planCode: "pro",
                    status: "active",
                    source: "system_migration",
                    cancelAtPeriodEnd: false,
                  },
                  entitlements: {
                    modelGatewayEnabled: true,
                    relayEnabled: true,
                    maxDesktopDevices: 3,
                    maxMobileDevices: 5,
                  },
                  balanceMicrocents: 250000000,
                  currency: "CNY",
                  rechargeUrl: "https://provider.example/billing",
                },
                credentials: [
                  {
                    method: "anybox-browser",
                    kind: "oauth_session",
                    source: "credential_store",
                    configured: true,
                  },
                ],
              },
            }),
          ],
          onDeleteProviderAuthSession,
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Account" }))

    expect(screen.getByText("Logged in")).toBeInTheDocument()
    expect(screen.getByText("agent@example.com")).toBeInTheDocument()
    expect(screen.getByText("Studio")).toBeInTheDocument()
    expect(screen.getByText("Pro")).toBeInTheDocument()
    expect(screen.getByText(/2\.50/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "anybox.com.cn" }))
    expect(openExternalUrl).toHaveBeenCalledWith({ url: "https://anybox.com.cn" })

    fireEvent.click(screen.getByRole("button", { name: "Recharge" }))
    expect(openExternalUrl).toHaveBeenCalledWith({ url: "https://provider.example/billing" })

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }))
    expect(onDeleteProviderAuthSession).toHaveBeenCalledWith("anybox")
  })

  it("opens the Provider dashboard when an Anybox account has no recharge URL", () => {
    const openExternalUrl = vi.fn().mockResolvedValue({
      ok: true,
      url: "https://provider.anybox.com.cn/app/dashboard",
    })
    setDesktopMock({ openExternalUrl })

    render(
      <SettingsPage
        {...createSettingsPageProps({
          catalog: [
            createAnyboxProvider({
              baseURL: "https://anybox.com.cn/v1",
              authState: {
                status: "connected",
                account: {
                  email: "agent@example.com",
                  workspaceName: "Studio",
                },
              },
            }),
          ],
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Account" }))
    fireEvent.click(screen.getByRole("button", { name: "Recharge" }))

    expect(openExternalUrl).toHaveBeenCalledWith({ url: "https://provider.anybox.com.cn/app/dashboard" })
  })

  it("moves Anybox provider browser login controls to the Account page", () => {
    const onStartProviderAuthFlow = vi.fn()
    render(
      <SettingsPage
        {...createSettingsPageProps({
          catalog: [createAnyboxProvider()],
          onStartProviderAuthFlow,
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Provider" }))

    expect(screen.getByText("Anybox login is managed by the Account page. Provider keeps endpoint, model, and connection test settings here.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Log in to Anybox" })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Open Account" }))
    expect(screen.getByRole("button", { name: "Log in to Anybox" })).toBeInTheDocument()
    expect(onStartProviderAuthFlow).not.toHaveBeenCalled()
  })

  it("hides provider logo fallback text after the remote logo image loads", () => {
    const { container } = render(
      <SettingsPage
        {...createSettingsPageProps({
          catalog: [createProvider("deepseek", "DeepSeek")],
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Provider" }))

    const logo = container.querySelector(".provider-logo")
    const fallback = logo?.querySelector(".provider-logo-fallback")
    const image = logo?.querySelector(".provider-logo-image")

    expect(fallback).not.toHaveAttribute("hidden")
    expect(image).not.toHaveAttribute("hidden")

    fireEvent.load(image!)

    expect(fallback).toHaveAttribute("hidden")
    expect(image).not.toHaveAttribute("hidden")
  })

  it("keeps provider logo fallback text when the remote logo image fails", () => {
    const { container } = render(
      <SettingsPage
        {...createSettingsPageProps({
          catalog: [createProvider("unknown-provider", "Unknown Provider")],
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Provider" }))

    const logo = container.querySelector(".provider-logo")
    const fallback = logo?.querySelector(".provider-logo-fallback")
    const image = logo?.querySelector(".provider-logo-image")

    fireEvent.error(image!)

    expect(fallback).not.toHaveAttribute("hidden")
    expect(image).toHaveAttribute("hidden")
  })

  it("opens the custom provider dialog and edits its four fields", () => {
    const onCustomProviderDraftChange = vi.fn()

    render(
      <SettingsPage
        {...createSettingsPageProps({
          onCustomProviderDraftChange,
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Provider" }))
    fireEvent.click(screen.getByRole("button", { name: "Add custom provider" }))

    expect(screen.getByRole("dialog", { name: "Custom Provider" })).toBeInTheDocument()

    const apiBaseURLInput = screen.getByRole("textbox", { name: "Custom provider API Base URL" })
    const defaultModelInput = screen.getByRole("textbox", { name: "Custom provider default model" })

    expect(apiBaseURLInput).toHaveAttribute("placeholder", "https://api.example.com/v1")
    expect(screen.getByLabelText("Custom provider API key")).toHaveAttribute("placeholder", "Enter API key")
    expect(defaultModelInput).toHaveAttribute("placeholder", "model-name")

    fireEvent.change(apiBaseURLInput, {
      target: { value: "https://api.example.com/v1" },
    })
    fireEvent.change(screen.getByLabelText("Custom provider API key"), {
      target: { value: "sk-test" },
    })
    fireEvent.change(defaultModelInput, {
      target: { value: "custom-chat-model" },
    })
    fireEvent.change(screen.getByRole("textbox", { name: "Custom provider chat endpoint" }), {
      target: { value: "/compatible/chat" },
    })

    expect(onCustomProviderDraftChange).toHaveBeenCalledWith("apiBaseURL", "https://api.example.com/v1")
    expect(onCustomProviderDraftChange).toHaveBeenCalledWith("apiKey", "sk-test")
    expect(onCustomProviderDraftChange).toHaveBeenCalledWith("defaultModel", "custom-chat-model")
    expect(onCustomProviderDraftChange).toHaveBeenCalledWith("chatEndpoint", "/compatible/chat")
  })

  it("tests and saves a complete custom provider draft", async () => {
    const onSaveCustomProvider = vi.fn().mockResolvedValue(true)
    const onTestCustomProviderConnection = vi.fn().mockResolvedValue(true)

    render(
      <SettingsPage
        {...createSettingsPageProps({
          customProviderDraft: {
            apiBaseURL: "https://api.example.com/v1",
            apiKey: "sk-test",
            defaultModel: "custom-chat-model",
            chatEndpoint: "/chat/completions",
          },
          onSaveCustomProvider,
          onTestCustomProviderConnection,
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Provider" }))
    fireEvent.click(screen.getByRole("button", { name: "Add custom provider" }))
    fireEvent.click(screen.getByRole("button", { name: "Test" }))
    fireEvent.click(screen.getByRole("button", { name: "Save custom provider" }))

    await waitFor(() => {
      expect(onTestCustomProviderConnection).toHaveBeenCalledTimes(1)
      expect(onSaveCustomProvider).toHaveBeenCalledTimes(1)
    })
  })

  it("shows detail header edit and delete buttons for custom providers", () => {
    const onDeleteProvider = vi.fn()
    const onCustomProviderDraftReset = vi.fn()
    const customProvider = {
      ...createProvider("custom-example", "Custom · api.example.com"),
      source: "config" as const,
      isCustomProvider: true,
      baseURL: "https://api.example.com/v1",
      customChatEndpoint: "/chat/completions",
      customDefaultModel: "deepseek-v4-flash",
    }
    const catalogProvider = {
      ...createProvider("openai", "OpenAI"),
      source: "api" as const,
    }

    render(
      <SettingsPage
        {...createSettingsPageProps({
          catalog: [customProvider, catalogProvider],
          models: [createModel("custom-example", "deepseek-v4-flash", "deepseek-v4-flash")],
          onDeleteProvider,
          onCustomProviderDraftReset,
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Provider" }))

    expect(screen.getByRole("button", { name: /Custom · api\.example\.com.*Connected/ })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Delete OpenAI" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Edit Custom · api.example.com" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Delete Custom · api.example.com" }))

    expect(onDeleteProvider).toHaveBeenCalledWith("custom-example")

    fireEvent.click(screen.getByRole("button", { name: "Edit Custom · api.example.com" }))

    expect(onCustomProviderDraftReset).toHaveBeenCalledWith({
      apiBaseURL: "https://api.example.com/v1",
      apiKey: "",
      defaultModel: "deepseek-v4-flash",
      chatEndpoint: "/chat/completions",
    })
    expect(screen.getByRole("dialog", { name: "Edit Custom Provider" })).toBeInTheDocument()
  })

  it("filters archived sessions by title, project, and path", () => {
    render(
      <SettingsPage
        {...createSettingsPageProps({
          archivedSessions: [
            createArchivedSession({
              id: "session-analysis",
              title: "Project analysis",
              projectName: "Research",
              directory: "C:\\Projects\\research",
            }),
            createArchivedSession({
              id: "session-git",
              title: "Git initialization",
              projectName: "Client App",
              directory: "C:\\Projects\\client-app",
            }),
          ],
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Archived Sessions" }))

    expect(screen.getByText("Project analysis")).toBeInTheDocument()
    expect(screen.getByText("Git initialization")).toBeInTheDocument()

    const searchBox = screen.getByRole("searchbox", { name: "Search archived sessions" })
    fireEvent.change(searchBox, { target: { value: "client" } })

    expect(screen.queryByText("Project analysis")).not.toBeInTheDocument()
    expect(screen.getByText("Git initialization")).toBeInTheDocument()

    fireEvent.change(searchBox, { target: { value: "missing" } })

    expect(screen.getByText("No matching sessions")).toBeInTheDocument()
    expect(screen.queryByRole("list", { name: "Archived sessions" })).not.toBeInTheDocument()
  })

  it("deletes all archived sessions from the archived sessions page", () => {
    const confirmDeleteAll = vi.spyOn(window, "confirm").mockReturnValue(true)
    const onDeleteAllArchivedSessions = vi.fn()

    render(
      <SettingsPage
        {...createSettingsPageProps({
          archivedSessions: [
            createArchivedSession({ id: "session-archived-1" }),
            createArchivedSession({ id: "session-archived-2" }),
          ],
          onDeleteAllArchivedSessions,
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Archived Sessions" }))
    fireEvent.click(screen.getByRole("button", { name: "Delete all" }))

    expect(confirmDeleteAll).toHaveBeenCalledWith("Permanently delete archived sessions (2)?")
    expect(onDeleteAllArchivedSessions).toHaveBeenCalledWith(["session-archived-1", "session-archived-2"])
  })

  it("does not delete all archived sessions when confirmation is cancelled", () => {
    const confirmDeleteAll = vi.spyOn(window, "confirm").mockReturnValue(false)
    const onDeleteAllArchivedSessions = vi.fn()

    render(
      <SettingsPage
        {...createSettingsPageProps({
          archivedSessions: [createArchivedSession()],
          onDeleteAllArchivedSessions,
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Archived Sessions" }))
    fireEvent.click(screen.getByRole("button", { name: "Delete all" }))

    expect(confirmDeleteAll).toHaveBeenCalledWith("Permanently delete archived sessions (1)?")
    expect(onDeleteAllArchivedSessions).not.toHaveBeenCalled()
  })

  it("disables delete all when there are no archived sessions", () => {
    render(<SettingsPage {...createSettingsPageProps()} />)

    fireEvent.click(screen.getByRole("button", { name: "Archived Sessions" }))

    expect(screen.getByRole("button", { name: "Delete all" })).toBeDisabled()
  })

  it("opens the monitor app from developer mode settings", async () => {
    const openMonitorWindow = vi.fn().mockResolvedValue({
      ok: true,
      reused: false,
      source: "file",
    })
    setDesktopMock({ openMonitorWindow })

    render(<SettingsPage {...createSettingsPageProps()} />)

    fireEvent.click(screen.getByRole("button", { name: "Developer Mode" }))
    fireEvent.click(screen.getByRole("button", { name: /Agent Monitor/ }))
    fireEvent.click(screen.getByRole("button", { name: "Open monitor" }))

    await waitFor(() => {
      expect(openMonitorWindow).toHaveBeenCalledTimes(1)
    })
  })

  it("keeps storage paths inside the developer mode storage disclosure", async () => {
    const getStoragePaths = vi.fn().mockResolvedValue({
      appData: "C:\\Users\\tester\\AppData\\Roaming\\anybox-desktop-agent",
      agentRoot: "C:\\Users\\tester\\AppData\\Roaming\\anybox-desktop-agent\\agent",
      agentData: "C:\\Users\\tester\\AppData\\Roaming\\anybox-desktop-agent\\agent\\data",
      installedPlugins: "C:\\Users\\tester\\AppData\\Roaming\\anybox-desktop-agent\\agent\\data\\plugins\\installed",
      pluginRegistryCache: "C:\\Users\\tester\\AppData\\Roaming\\anybox-desktop-agent\\agent\\data\\plugins\\registry-cache",
      agentCache: "C:\\Users\\tester\\AppData\\Roaming\\anybox-desktop-agent\\agent\\cache",
      pluginInstallTemp: "C:\\Users\\tester\\AppData\\Roaming\\anybox-desktop-agent\\agent\\cache\\plugin-installs",
    })
    setDesktopMock({ getStoragePaths })

    render(<SettingsPage {...createSettingsPageProps()} />)

    expect(screen.queryByText("Storage Locations")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Developer Mode" }))

    const storageDisclosure = screen.getByRole("button", { name: /Storage Locations/ })
    expect(storageDisclosure).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByText("Application data")).not.toBeInTheDocument()

    await waitFor(() => {
      expect(getStoragePaths).toHaveBeenCalledTimes(1)
    })

    fireEvent.click(storageDisclosure)

    expect(await screen.findByText("Application data")).toBeInTheDocument()
    expect(screen.getByText("Plugin install temp")).toBeInTheDocument()
    expect(screen.getByTitle("C:\\Users\\tester\\AppData\\Roaming\\anybox-desktop-agent")).toBeInTheDocument()
  })

  it("switches the display language from general settings", async () => {
    window.localStorage.setItem("desktop.locale", "en-US")
    const saveLocaleConfig = vi.fn().mockResolvedValue({
      path: "locale-settings.json",
      exists: true,
      document: {
        version: 1,
        locale: "zh-CN",
        updatedAt: 1,
      },
    })

    setDesktopMock({
      getLocaleConfig: vi.fn().mockResolvedValue({
        path: "locale-settings.json",
        exists: true,
        document: {
          version: 1,
          locale: "en-US",
          updatedAt: 1,
        },
      }),
      saveLocaleConfig,
    })

    render(
      <I18nProvider>
        <SettingsPage {...createSettingsPageProps()} />
      </I18nProvider>,
    )

    expect(await screen.findByRole("combobox", { name: "Display Language" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "General" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "About" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Appearance" }))
    expect(screen.queryByRole("combobox", { name: "Display Language" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "General" }))

    selectSettingsOption("Display Language", "中文")

    await waitFor(() => {
      expect(saveLocaleConfig).toHaveBeenCalledWith({
        document: expect.objectContaining({
          locale: "zh-CN",
          version: 1,
        }),
      })
    })
    expect(await screen.findByText("显示语言")).toBeInTheDocument()
  })

  it("selects the interface font from appearance settings", () => {
    const onFontFamilyChange = vi.fn()

    render(
      <SettingsPage
        {...createSettingsPageProps({
          fontFamily: "system",
          onFontFamilyChange,
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Appearance" }))
    expect(screen.getByText("Interface Font")).toBeInTheDocument()

    selectSettingsOption("Interface Font", "微软雅黑")

    expect(onFontFamilyChange).toHaveBeenCalledWith("microsoft-yahei")
  })

  it("edits the static HTML background settings from appearance", () => {
    const onHtmlBackgroundConfigChange = vi.fn()

    const { rerender } = render(
      <SettingsPage
        {...createSettingsPageProps({
          onHtmlBackgroundConfigChange,
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Appearance" }))

    const enableButton = screen.getByRole("switch", { name: "Enable HTML background" })
    expect(enableButton).toBeDisabled()

    fireEvent.change(screen.getByLabelText("HTML source"), {
      target: {
        value: "<main>Custom background</main>",
      },
    })

    expect(onHtmlBackgroundConfigChange).toHaveBeenCalledWith(expect.objectContaining({
      enabled: false,
      html: "<main>Custom background</main>",
    }))

    rerender(
      <SettingsPage
        {...createSettingsPageProps({
          htmlBackgroundConfig: {
            blurPx: 0,
            dim: 0.18,
            enabled: false,
            html: "<main>Custom background</main>",
            opacity: 0.78,
            paused: false,
            renderMode: "static",
            surfaceOpacity: 0.68,
          },
          onHtmlBackgroundConfigChange,
        })}
      />,
    )

    fireEvent.click(screen.getByRole("switch", { name: "Enable HTML background" }))
    expect(onHtmlBackgroundConfigChange).toHaveBeenCalledWith(expect.objectContaining({
      enabled: true,
      html: "<main>Custom background</main>",
    }))

    fireEvent.change(screen.getByRole("slider", { name: /Surface opacity/ }), {
      target: {
        value: "0.72",
      },
    })

    expect(onHtmlBackgroundConfigChange).toHaveBeenCalledWith(expect.objectContaining({
      surfaceOpacity: 0.72,
    }))

    fireEvent.click(screen.getByRole("switch", { name: "Dynamic script background" }))

    expect(onHtmlBackgroundConfigChange).toHaveBeenCalledWith(expect.objectContaining({
      renderMode: "dynamic",
    }))
  })

  it("filters appearance theme tokens by semantic token name", () => {
    render(<SettingsPage {...createSettingsPageProps()} />)

    fireEvent.click(screen.getByRole("button", { name: "Appearance" }))

    expect(screen.getByText("App Background")).toBeInTheDocument()

    const searchBox = screen.getByRole("searchbox", { name: "Search semantic tokens" })
    fireEvent.change(searchBox, {
      target: { value: "semantic-sidebar-tree-row-surface-active" },
    })

    expect(screen.getByText("Row Surface Active")).toBeInTheDocument()
    expect(screen.getByText("semantic-sidebar-tree-row-surface-active")).toBeInTheDocument()
    expect(screen.queryByText("App Background")).not.toBeInTheDocument()

    fireEvent.change(searchBox, {
      target: { value: "semantic-settings-list-detail-row-surface-hover" },
    })

    expect(screen.getByText("Settings List Detail Rows")).toBeInTheDocument()
    expect(screen.getByText("semantic-settings-list-detail-row-surface-hover")).toBeInTheDocument()
    expect(screen.queryByText("App Background")).not.toBeInTheDocument()

    fireEvent.change(searchBox, {
      target: { value: "semantic-button-primary-surface" },
    })

    expect(screen.getByText("Buttons")).toBeInTheDocument()
    expect(screen.getByText("Primary Surface")).toBeInTheDocument()
    expect(screen.getByText("semantic-button-primary-surface")).toBeInTheDocument()
    expect(screen.queryByText("App Background")).not.toBeInTheDocument()

    fireEvent.change(searchBox, {
      target: { value: "no-such-token" },
    })

    expect(screen.getByText("No matching tokens")).toBeInTheDocument()
  })

  it("edits appearance token alpha values", () => {
    const appearanceTokenValues = createAppearanceTokenValues("#000000")
    appearanceTokenValues["border-default-light"] = "rgba(41, 37, 36, 0.08)"
    const onAppearanceTokenChange = vi.fn()

    render(
      <SettingsPage
        {...createSettingsPageProps({
          appearanceTokenValues,
          onAppearanceTokenChange,
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Appearance" }))
    fireEvent.click(screen.getByRole("button", {
      name: "Foundation / Content Default Border Light border-default-light",
    }))

    const alphaInput = screen.getByRole("slider", {
      name: "Foundation / Content Default Border Light border-default-light alpha",
    }) as HTMLInputElement
    expect(alphaInput.value).toBe("0.08")

    fireEvent.change(alphaInput, { target: { value: "0.42" } })
    expect(onAppearanceTokenChange).toHaveBeenCalledWith(
      "border-default-light",
      "rgba(41, 37, 36, 0.42)",
    )

    fireEvent.change(screen.getByRole("slider", {
      name: "Foundation / Content Default Border Light border-default-light hue",
    }), {
      target: { value: "180" },
    })
    expect(onAppearanceTokenChange).toHaveBeenCalledWith(
      "border-default-light",
      "rgba(36, 41, 41, 0.08)",
    )

    const colorInput = screen.getByLabelText(
      "Foundation / Content Default Border Light border-default-light color value",
    )
    fireEvent.change(colorInput, { target: { value: "rgba(1, 2, 3, 0.5)" } })
    fireEvent.blur(colorInput)
    expect(onAppearanceTokenChange).toHaveBeenCalledWith(
      "border-default-light",
      "rgba(1, 2, 3, 0.5)",
    )
  })

  it("filters appearance theme tokens by group", () => {
    render(<SettingsPage {...createSettingsPageProps()} />)

    fireEvent.click(screen.getByRole("button", { name: "Appearance" }))

    selectSettingsOption("Filter token group", "Foundation / Content")

    expect(screen.getAllByText("Foundation / Content").length).toBeGreaterThan(0)
    expect(screen.getByText("Primary Text")).toBeInTheDocument()
    expect(screen.queryByText("App Background")).not.toBeInTheDocument()
  })

  it("filters appearance theme tokens to customized rows", () => {
    render(
      <SettingsPage
        {...createSettingsPageProps({
          appearanceOverrides: {
            "surface-app-light": "#ffffff",
          },
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Appearance" }))

    selectSettingsOption("Filter token status", "Customized only")

    expect(screen.getByText("App Background")).toBeInTheDocument()
    expect(screen.queryByText("Shell Background")).not.toBeInTheDocument()
  })

  it("uses localized appearance labels without helper descriptions in Chinese", () => {
    window.localStorage.setItem("desktop.locale", "zh-CN")

    render(
      <I18nProvider>
        <SettingsPage
          {...createSettingsPageProps({
            brandTheme: "terra",
            fontFamily: "microsoft-yahei",
          })}
        />
      </I18nProvider>,
    )

    fireEvent.click(screen.getByRole("button", { name: "外观" }))

    expect(screen.getByRole("combobox", { name: "强调主题" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("combobox", { name: "强调主题" }))
    expect(within(screen.getByRole("listbox", { name: "强调主题" })).getByRole("option", { name: "暖色 Terra 与沙色" })).toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "界面字体" })).toBeInTheDocument()
    expect(screen.queryByText("选择亮色、暗色或跟随系统的配色方案。")).not.toBeInTheDocument()
    expect(screen.queryByText(/Choose the font used across the desktop interface/i)).not.toBeInTheDocument()
  })

  it("selects the primary model through the provider model picker", () => {
    const onSelectionChange = vi.fn()

    render(
      <SettingsPage
        {...createSettingsPageProps({
          catalog: [createProvider("deepseek", "DeepSeek"), createProvider("openai", "OpenAI")],
          models: [
            createModel("deepseek", "deepseek-reasoner", "DeepSeek Reasoner", { reasoning: true }),
            createModel("openai", "gpt-4o-mini", "GPT-4o mini"),
          ],
          onSelectionChange,
          selectionDraft: {
            model: "deepseek/deepseek-reasoner",
            smallModel: null,
            reasoningEffort: null,
            imageModel: null,
            imageDefaultSize: null,
            imageDefaultCount: null,
          },
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Models" }))
    fireEvent.click(screen.getByRole("button", { name: "Primary model: DeepSeek / DeepSeek Reasoner" }))

    const picker = screen.getByRole("dialog", { name: "Primary model model picker" })
    const providerList = within(picker).getByRole("listbox", { name: "Primary model providers" })
    const modelList = within(picker).getByRole("listbox", { name: "Primary model models" })
    expect(within(providerList).getByRole("option", { name: /DeepSeek/ })).toHaveAttribute("aria-selected", "true")
    expect(within(modelList).getByRole("option", { name: "DeepSeek Reasoner" })).toHaveAttribute(
      "aria-selected",
      "true",
    )

    fireEvent.change(within(picker).getByRole("searchbox", { name: "Search providers or models" }), {
      target: {
        value: "openai",
      },
    })

    expect(within(providerList).queryByRole("option", { name: /DeepSeek/ })).not.toBeInTheDocument()
    fireEvent.click(within(modelList).getByRole("option", { name: "GPT-4o mini" }))
    expect(onSelectionChange).toHaveBeenCalledWith("model", "openai/gpt-4o-mini")
  })

  it("uses the picker for small models and filters image generation models", () => {
    const onSelectionChange = vi.fn()

    render(
      <SettingsPage
        {...createSettingsPageProps({
          catalog: [createProvider("deepseek", "DeepSeek"), createProvider("openai", "OpenAI")],
          models: [
            createModel("deepseek", "deepseek-reasoner", "DeepSeek Reasoner", { reasoning: true }),
            createModel("openai", "gpt-4o-mini", "GPT-4o mini"),
            createModel("openai", "gpt-image-1", "GPT Image", { imageOutput: true }),
          ],
          onSelectionChange,
        })}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Models" }))
    expect(screen.queryByRole("button", { name: "Save model selection" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Small model: Use server default" }))
    fireEvent.click(screen.getByRole("option", { name: "DeepSeek Reasoner" }))
    expect(onSelectionChange).toHaveBeenCalledWith("smallModel", "deepseek/deepseek-reasoner")
    expect(screen.queryByRole("dialog", { name: "Small model model picker" })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Image generation model: Not configured" }))
    const picker = screen.getByRole("dialog", { name: "Image generation model model picker" })
    const modelList = within(picker).getByRole("listbox", { name: "Image generation model models" })

    expect(within(modelList).getByRole("option", { name: "GPT Image" })).toBeInTheDocument()
    expect(within(modelList).queryByRole("option", { name: "GPT-4o mini" })).not.toBeInTheDocument()

    fireEvent.click(within(modelList).getByRole("option", { name: "GPT Image" }))
    expect(onSelectionChange).toHaveBeenCalledWith("imageModel", "openai/gpt-image-1")
  })
})
